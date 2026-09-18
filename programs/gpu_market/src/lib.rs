use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, TransferChecked};

declare_id!("BhgV3HcxzK9aUnhcfyez96ctBhESzvZXuE6A3x8LhuLG");

const TOKEN_DECIMALS: u8 = 6;
const SCALE: u128 = 1_000_000;
const BPS: u128 = 10_000;
const INDEX_SWAP_FEE_BPS: u128 = 30;
const FAUCET_AMOUNT: u64 = 10_000 * 1_000_000;
const MARKET_SUPPLY_RAW: u64 = 1_000_000_000 * 1_000_000;
const VIRTUAL_BASE_RAW: u128 = 1_286_000_000u128 * 1_000_000u128;
const OPENING_TOKEN_PRICE_MICRO_USD: u128 = 5;

#[program]
pub mod gpu_market {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        require!(
            ctx.accounts.quote_mint.mint_authority == COption::Some(ctx.accounts.config.key()),
            ExchangeError::InvalidMintAuthority
        );
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.oracle_authority = ctx.accounts.authority.key();
        config.quote_mint = ctx.accounts.quote_mint.key();
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn register_index(
        ctx: Context<RegisterIndex>,
        symbol: [u8; 12],
        symbol_len: u8,
        price_micro_usd: u64,
        max_age_seconds: i64,
    ) -> Result<()> {
        require!(
            symbol_len > 0 && symbol_len <= 12,
            ExchangeError::InvalidSymbol
        );
        require!(price_micro_usd > 0, ExchangeError::InvalidPrice);
        require!(max_age_seconds >= 60, ExchangeError::InvalidMaxAge);

        let now = Clock::get()?.unix_timestamp;
        let feed = &mut ctx.accounts.feed;
        feed.symbol = symbol;
        feed.symbol_len = symbol_len;
        feed.index_mint = ctx.accounts.index_mint.key();
        feed.quote_vault = ctx.accounts.quote_vault.key();
        feed.price_micro_usd = price_micro_usd;
        feed.updated_at = now;
        feed.max_age_seconds = max_age_seconds;
        feed.total_minted = 0;
        feed.total_redeemed = 0;
        feed.feed_bump = ctx.bumps.feed;
        feed.mint_bump = ctx.bumps.index_mint;
        feed.vault_bump = ctx.bumps.quote_vault;

        emit!(PriceUpdated {
            feed: feed.key(),
            price_micro_usd,
            updated_at: now,
        });
        Ok(())
    }

    pub fn update_price(ctx: Context<UpdatePrice>, price_micro_usd: u64) -> Result<()> {
        require!(price_micro_usd > 0, ExchangeError::InvalidPrice);
        let now = Clock::get()?.unix_timestamp;
        let feed = &mut ctx.accounts.feed;
        feed.price_micro_usd = price_micro_usd;
        feed.updated_at = now;
        emit!(PriceUpdated {
            feed: feed.key(),
            price_micro_usd,
            updated_at: now
        });
        Ok(())
    }

    pub fn claim_test_usdc(ctx: Context<ClaimTestUsdc>) -> Result<()> {
        require!(
            !ctx.accounts.receipt.claimed,
            ExchangeError::FaucetAlreadyClaimed
        );
        let signer: &[&[u8]] = &[b"config", &[ctx.accounts.config.bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.user_quote.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[signer],
            ),
            FAUCET_AMOUNT,
        )?;
        ctx.accounts.receipt.claimed = true;
        ctx.accounts.receipt.owner = ctx.accounts.user.key();
        ctx.accounts.receipt.bump = ctx.bumps.receipt;
        Ok(())
    }

    pub fn buy_index(ctx: Context<BuyIndex>, quote_in: u64, minimum_index_out: u64) -> Result<()> {
        require!(quote_in > 0, ExchangeError::InvalidAmount);
        assert_fresh(&ctx.accounts.feed)?;
        let effective = (quote_in as u128)
            .checked_mul(BPS - INDEX_SWAP_FEE_BPS)
            .ok_or(ExchangeError::MathOverflow)?
            .checked_div(BPS)
            .ok_or(ExchangeError::MathOverflow)?;
        let index_out = effective
            .checked_mul(SCALE)
            .ok_or(ExchangeError::MathOverflow)?
            .checked_div(ctx.accounts.feed.price_micro_usd as u128)
            .ok_or(ExchangeError::MathOverflow)?;
        let index_out = to_u64(index_out)?;
        require!(
            index_out >= minimum_index_out && index_out > 0,
            ExchangeError::SlippageExceeded
        );

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_quote.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.quote_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            quote_in,
            TOKEN_DECIMALS,
        )?;

        let config_signer: &[&[u8]] = &[b"config", &[ctx.accounts.config.bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.index_mint.to_account_info(),
                    to: ctx.accounts.user_index.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[config_signer],
            ),
            index_out,
        )?;
        ctx.accounts.feed.total_minted = ctx
            .accounts
            .feed
            .total_minted
            .checked_add(index_out)
            .ok_or(ExchangeError::MathOverflow)?;
        emit!(IndexSwap {
            user: ctx.accounts.user.key(),
            feed: ctx.accounts.feed.key(),
            is_buy: true,
            quote_amount: quote_in,
            index_amount: index_out
        });
        Ok(())
    }

    pub fn sell_index(
        ctx: Context<SellIndex>,
        index_in: u64,
        minimum_quote_out: u64,
    ) -> Result<()> {
        require!(index_in > 0, ExchangeError::InvalidAmount);
        assert_fresh(&ctx.accounts.feed)?;
        let gross = (index_in as u128)
            .checked_mul(ctx.accounts.feed.price_micro_usd as u128)
            .ok_or(ExchangeError::MathOverflow)?
            .checked_div(SCALE)
            .ok_or(ExchangeError::MathOverflow)?;
        let quote_out = gross
            .checked_mul(BPS - INDEX_SWAP_FEE_BPS)
            .ok_or(ExchangeError::MathOverflow)?
            .checked_div(BPS)
            .ok_or(ExchangeError::MathOverflow)?;
        let quote_out = to_u64(quote_out)?;
        require!(
            quote_out >= minimum_quote_out && quote_out > 0,
            ExchangeError::SlippageExceeded
        );
        require!(
            ctx.accounts.quote_vault.amount >= quote_out,
            ExchangeError::InsufficientBidLiquidity
        );

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.index_mint.to_account_info(),
                    from: ctx.accounts.user_index.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            index_in,
        )?;

        let symbol = ctx.accounts.feed.symbol;
        let signer: &[&[u8]] = &[b"feed", &symbol, &[ctx.accounts.feed.feed_bump]];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.quote_vault.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.user_quote.to_account_info(),
                    authority: ctx.accounts.feed.to_account_info(),
                },
                &[signer],
            ),
            quote_out,
            TOKEN_DECIMALS,
        )?;
        ctx.accounts.feed.total_redeemed = ctx
            .accounts
            .feed
            .total_redeemed
            .checked_add(index_in)
            .ok_or(ExchangeError::MathOverflow)?;
        emit!(IndexSwap {
            user: ctx.accounts.user.key(),
            feed: ctx.accounts.feed.key(),
            is_buy: false,
            quote_amount: quote_out,
            index_amount: index_in
        });
        Ok(())
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        nonce: u64,
        name: [u8; 32],
        name_len: u8,
        symbol: [u8; 8],
        symbol_len: u8,
        fee_bps: u16,
    ) -> Result<()> {
        require!(
            name_len > 0 && name_len <= 32 && symbol_len > 0 && symbol_len <= 8,
            ExchangeError::InvalidSymbol
        );
        require!((100..=300).contains(&fee_bps), ExchangeError::InvalidFee);
        assert_fresh(&ctx.accounts.feed)?;

        let virtual_quote = VIRTUAL_BASE_RAW
            .checked_mul(OPENING_TOKEN_PRICE_MICRO_USD)
            .ok_or(ExchangeError::MathOverflow)?
            .checked_div(ctx.accounts.feed.price_micro_usd as u128)
            .ok_or(ExchangeError::MathOverflow)?;
        require!(virtual_quote > 0, ExchangeError::InvalidPrice);

        let market = &mut ctx.accounts.market;
        market.creator = ctx.accounts.creator.key();
        market.market_mint = ctx.accounts.market_mint.key();
        market.pair_feed = ctx.accounts.feed.key();
        market.pair_mint = ctx.accounts.pair_mint.key();
        market.token_vault = ctx.accounts.token_vault.key();
        market.pair_vault = ctx.accounts.pair_vault.key();
        market.name = name;
        market.name_len = name_len;
        market.symbol = symbol;
        market.symbol_len = symbol_len;
        market.nonce = nonce;
        market.fee_bps = fee_bps;
        market.virtual_base = VIRTUAL_BASE_RAW;
        market.virtual_quote = virtual_quote;
        market.tokens_sold = 0;
        market.holder_fees = 0;
        market.buyback_fees = 0;
        market.protocol_fees = 0;
        market.bump = ctx.bumps.market;
        market.mint_bump = ctx.bumps.market_mint;
        market.token_vault_bump = ctx.bumps.token_vault;
        market.pair_vault_bump = ctx.bumps.pair_vault;

        let creator_key = ctx.accounts.creator.key();
        let nonce_bytes = nonce.to_le_bytes();
        let signer: &[&[u8]] = &[
            b"market",
            creator_key.as_ref(),
            &nonce_bytes,
            &[market.bump],
        ];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.market_mint.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: market.to_account_info(),
                },
                &[signer],
            ),
            MARKET_SUPPLY_RAW,
        )?;

        emit!(MarketCreated {
            market: market.key(),
            creator: market.creator,
            market_mint: market.market_mint,
            pair_feed: market.pair_feed,
            fee_bps
        });
        Ok(())
    }

    pub fn buy_market(
        ctx: Context<TradeMarket>,
        pair_in: u64,
        minimum_tokens_out: u64,
    ) -> Result<()> {
        require!(pair_in > 0, ExchangeError::InvalidAmount);
        assert_fresh(&ctx.accounts.pair_feed)?;
        let market = &mut ctx.accounts.market;
        let fee = (pair_in as u128)
            .checked_mul(market.fee_bps as u128)
            .ok_or(ExchangeError::MathOverflow)?
            .checked_div(BPS)
            .ok_or(ExchangeError::MathOverflow)?;
        let effective = (pair_in as u128)
            .checked_sub(fee)
            .ok_or(ExchangeError::MathOverflow)?;
        let k = market
            .virtual_base
            .checked_mul(market.virtual_quote)
            .ok_or(ExchangeError::MathOverflow)?;
        let new_quote = market
            .virtual_quote
            .checked_add(effective)
            .ok_or(ExchangeError::MathOverflow)?;
        let new_base = k
            .checked_div(new_quote)
            .ok_or(ExchangeError::MathOverflow)?;
        let tokens_out = market
            .virtual_base
            .checked_sub(new_base)
            .ok_or(ExchangeError::MathOverflow)?;
        let tokens_out_u64 = to_u64(tokens_out)?;
        require!(
            tokens_out_u64 >= minimum_tokens_out && tokens_out_u64 > 0,
            ExchangeError::SlippageExceeded
        );
        require!(
            ctx.accounts.token_vault.amount >= tokens_out_u64,
            ExchangeError::InsufficientInventory
        );

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_pair.to_account_info(),
                    mint: ctx.accounts.pair_mint.to_account_info(),
                    to: ctx.accounts.pair_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            pair_in,
            TOKEN_DECIMALS,
        )?;

        let creator = market.creator;
        let nonce_bytes = market.nonce.to_le_bytes();
        let signer: &[&[u8]] = &[b"market", creator.as_ref(), &nonce_bytes, &[market.bump]];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.token_vault.to_account_info(),
                    mint: ctx.accounts.market_mint.to_account_info(),
                    to: ctx.accounts.user_market.to_account_info(),
                    authority: market.to_account_info(),
                },
                &[signer],
            ),
            tokens_out_u64,
            TOKEN_DECIMALS,
        )?;

        market.virtual_base = new_base;
        market.virtual_quote = new_quote;
        market.tokens_sold = market
            .tokens_sold
            .checked_add(tokens_out_u64)
            .ok_or(ExchangeError::MathOverflow)?;
        accrue_fee(market, to_u64(fee)?)?;
        emit!(MarketSwap {
            market: market.key(),
            user: ctx.accounts.user.key(),
            is_buy: true,
            pair_amount: pair_in,
            token_amount: tokens_out_u64
        });
        Ok(())
    }

    pub fn sell_market(
        ctx: Context<TradeMarket>,
        tokens_in: u64,
        minimum_pair_out: u64,
    ) -> Result<()> {
        require!(tokens_in > 0, ExchangeError::InvalidAmount);
        assert_fresh(&ctx.accounts.pair_feed)?;
        let market = &mut ctx.accounts.market;
        let k = market
            .virtual_base
            .checked_mul(market.virtual_quote)
            .ok_or(ExchangeError::MathOverflow)?;
        let new_base = market
            .virtual_base
            .checked_add(tokens_in as u128)
            .ok_or(ExchangeError::MathOverflow)?;
        let new_quote = k.checked_div(new_base).ok_or(ExchangeError::MathOverflow)?;
        let gross = market
            .virtual_quote
            .checked_sub(new_quote)
            .ok_or(ExchangeError::MathOverflow)?;
        let fee = gross
            .checked_mul(market.fee_bps as u128)
            .ok_or(ExchangeError::MathOverflow)?
            .checked_div(BPS)
            .ok_or(ExchangeError::MathOverflow)?;
        let pair_out = gross.checked_sub(fee).ok_or(ExchangeError::MathOverflow)?;
        let pair_out_u64 = to_u64(pair_out)?;
        require!(
            pair_out_u64 >= minimum_pair_out && pair_out_u64 > 0,
            ExchangeError::SlippageExceeded
        );
        let reserved_fees = market
            .holder_fees
            .checked_add(market.buyback_fees)
            .and_then(|v| v.checked_add(market.protocol_fees))
            .ok_or(ExchangeError::MathOverflow)?;
        require!(
            ctx.accounts.pair_vault.amount.saturating_sub(reserved_fees) >= pair_out_u64,
            ExchangeError::InsufficientBidLiquidity
        );

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_market.to_account_info(),
                    mint: ctx.accounts.market_mint.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            tokens_in,
            TOKEN_DECIMALS,
        )?;

        let creator = market.creator;
        let nonce_bytes = market.nonce.to_le_bytes();
        let signer: &[&[u8]] = &[b"market", creator.as_ref(), &nonce_bytes, &[market.bump]];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.pair_vault.to_account_info(),
                    mint: ctx.accounts.pair_mint.to_account_info(),
                    to: ctx.accounts.user_pair.to_account_info(),
                    authority: market.to_account_info(),
                },
                &[signer],
            ),
            pair_out_u64,
            TOKEN_DECIMALS,
        )?;

        market.virtual_base = new_base;
        market.virtual_quote = new_quote;
        market.tokens_sold = market.tokens_sold.saturating_sub(tokens_in);
        accrue_fee(market, to_u64(fee)?)?;
        emit!(MarketSwap {
            market: market.key(),
            user: ctx.accounts.user.key(),
            is_buy: false,
            pair_amount: pair_out_u64,
            token_amount: tokens_in
        });
        Ok(())
    }
}

fn assert_fresh(feed: &IndexFeed) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        now.saturating_sub(feed.updated_at) <= feed.max_age_seconds,
        ExchangeError::StalePrice
    );
    Ok(())
}

fn to_u64(value: u128) -> Result<u64> {
    u64::try_from(value).map_err(|_| error!(ExchangeError::MathOverflow))
}

fn accrue_fee(market: &mut Market, fee: u64) -> Result<()> {
    let holder = fee
        .checked_mul(40)
        .ok_or(ExchangeError::MathOverflow)?
        .checked_div(100)
        .ok_or(ExchangeError::MathOverflow)?;
    let buyback = fee
        .checked_mul(30)
        .ok_or(ExchangeError::MathOverflow)?
        .checked_div(100)
        .ok_or(ExchangeError::MathOverflow)?;
    let protocol = fee
        .checked_sub(holder)
        .and_then(|v| v.checked_sub(buyback))
        .ok_or(ExchangeError::MathOverflow)?;
    market.holder_fees = market
        .holder_fees
        .checked_add(holder)
        .ok_or(ExchangeError::MathOverflow)?;
    market.buyback_fees = market
        .buyback_fees
        .checked_add(buyback)
        .ok_or(ExchangeError::MathOverflow)?;
    market.protocol_fees = market
        .protocol_fees
        .checked_add(protocol)
        .ok_or(ExchangeError::MathOverflow)?;
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub quote_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(symbol: [u8; 12])]
pub struct RegisterIndex<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority, has_one = quote_mint)]
    pub config: Account<'info, Config>,
    #[account(init, payer = authority, space = 8 + IndexFeed::INIT_SPACE, seeds = [b"feed", symbol.as_ref()], bump)]
    pub feed: Account<'info, IndexFeed>,
    #[account(init, payer = authority, seeds = [b"index-mint", symbol.as_ref()], bump, mint::decimals = TOKEN_DECIMALS, mint::authority = config)]
    pub index_mint: Account<'info, Mint>,
    #[account(init, payer = authority, seeds = [b"quote-vault", symbol.as_ref()], bump, token::mint = quote_mint, token::authority = feed)]
    pub quote_vault: Account<'info, TokenAccount>,
    pub quote_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = oracle_authority)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub feed: Account<'info, IndexFeed>,
    pub oracle_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimTestUsdc<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = quote_mint)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub quote_mint: Account<'info, Mint>,
    #[account(init_if_needed, payer = user, associated_token::mint = quote_mint, associated_token::authority = user)]
    pub user_quote: Account<'info, TokenAccount>,
    #[account(init, payer = user, space = 8 + FaucetReceipt::INIT_SPACE, seeds = [b"faucet", user.key().as_ref()], bump)]
    pub receipt: Account<'info, FaucetReceipt>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyIndex<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = quote_mint)]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = index_mint, has_one = quote_vault)]
    pub feed: Account<'info, IndexFeed>,
    #[account(mut)]
    pub quote_mint: Account<'info, Mint>,
    #[account(mut)]
    pub index_mint: Account<'info, Mint>,
    #[account(mut, token::mint = quote_mint, token::authority = user)]
    pub user_quote: Account<'info, TokenAccount>,
    #[account(init_if_needed, payer = user, associated_token::mint = index_mint, associated_token::authority = user)]
    pub user_index: Account<'info, TokenAccount>,
    #[account(mut, address = feed.quote_vault, token::mint = quote_mint, token::authority = feed)]
    pub quote_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SellIndex<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = quote_mint)]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = index_mint, has_one = quote_vault)]
    pub feed: Account<'info, IndexFeed>,
    #[account(mut)]
    pub quote_mint: Account<'info, Mint>,
    #[account(mut)]
    pub index_mint: Account<'info, Mint>,
    #[account(mut, token::mint = quote_mint, token::authority = user)]
    pub user_quote: Account<'info, TokenAccount>,
    #[account(mut, token::mint = index_mint, token::authority = user)]
    pub user_index: Account<'info, TokenAccount>,
    #[account(mut, address = feed.quote_vault, token::mint = quote_mint, token::authority = feed)]
    pub quote_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateMarket<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub feed: Account<'info, IndexFeed>,
    #[account(address = feed.index_mint)]
    pub pair_mint: Account<'info, Mint>,
    #[account(init, payer = creator, space = 8 + Market::INIT_SPACE, seeds = [b"market", creator.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub market: Account<'info, Market>,
    #[account(init, payer = creator, seeds = [b"market-mint", market.key().as_ref()], bump, mint::decimals = TOKEN_DECIMALS, mint::authority = market)]
    pub market_mint: Account<'info, Mint>,
    #[account(init, payer = creator, seeds = [b"market-token-vault", market.key().as_ref()], bump, token::mint = market_mint, token::authority = market)]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(init, payer = creator, seeds = [b"market-pair-vault", market.key().as_ref()], bump, token::mint = pair_mint, token::authority = market)]
    pub pair_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TradeMarket<'info> {
    #[account(mut, has_one = pair_feed, has_one = pair_mint, has_one = market_mint, has_one = token_vault, has_one = pair_vault, seeds = [b"market", market.creator.as_ref(), &market.nonce.to_le_bytes()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(address = market.pair_feed)]
    pub pair_feed: Account<'info, IndexFeed>,
    #[account(mut)]
    pub pair_mint: Account<'info, Mint>,
    #[account(mut)]
    pub market_mint: Account<'info, Mint>,
    #[account(mut, address = market.token_vault, token::mint = market_mint, token::authority = market)]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(mut, address = market.pair_vault, token::mint = pair_mint, token::authority = market)]
    pub pair_vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = pair_mint, token::authority = user)]
    pub user_pair: Account<'info, TokenAccount>,
    #[account(init_if_needed, payer = user, associated_token::mint = market_mint, associated_token::authority = user)]
    pub user_market: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub oracle_authority: Pubkey,
    pub quote_mint: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct IndexFeed {
    pub symbol: [u8; 12],
    pub symbol_len: u8,
    pub index_mint: Pubkey,
    pub quote_vault: Pubkey,
    pub price_micro_usd: u64,
    pub updated_at: i64,
    pub max_age_seconds: i64,
    pub total_minted: u64,
    pub total_redeemed: u64,
    pub feed_bump: u8,
    pub mint_bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct FaucetReceipt {
    pub owner: Pubkey,
    pub claimed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub creator: Pubkey,
    pub market_mint: Pubkey,
    pub pair_feed: Pubkey,
    pub pair_mint: Pubkey,
    pub token_vault: Pubkey,
    pub pair_vault: Pubkey,
    pub name: [u8; 32],
    pub name_len: u8,
    pub symbol: [u8; 8],
    pub symbol_len: u8,
    pub nonce: u64,
    pub fee_bps: u16,
    pub virtual_base: u128,
    pub virtual_quote: u128,
    pub tokens_sold: u64,
    pub holder_fees: u64,
    pub buyback_fees: u64,
    pub protocol_fees: u64,
    pub bump: u8,
    pub mint_bump: u8,
    pub token_vault_bump: u8,
    pub pair_vault_bump: u8,
}

#[event]
pub struct PriceUpdated {
    pub feed: Pubkey,
    pub price_micro_usd: u64,
    pub updated_at: i64,
}
#[event]
pub struct IndexSwap {
    pub user: Pubkey,
    pub feed: Pubkey,
    pub is_buy: bool,
    pub quote_amount: u64,
    pub index_amount: u64,
}
#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub market_mint: Pubkey,
    pub pair_feed: Pubkey,
    pub fee_bps: u16,
}
#[event]
pub struct MarketSwap {
    pub market: Pubkey,
    pub user: Pubkey,
    pub is_buy: bool,
    pub pair_amount: u64,
    pub token_amount: u64,
}

#[error_code]
pub enum ExchangeError {
    #[msg("Invalid mint authority")]
    InvalidMintAuthority,
    #[msg("Invalid symbol or name")]
    InvalidSymbol,
    #[msg("Invalid price")]
    InvalidPrice,
    #[msg("Invalid maximum age")]
    InvalidMaxAge,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid trading fee")]
    InvalidFee,
    #[msg("Price feed is stale")]
    StalePrice,
    #[msg("Slippage limit exceeded")]
    SlippageExceeded,
    #[msg("The pool has insufficient bid liquidity")]
    InsufficientBidLiquidity,
    #[msg("The market has insufficient token inventory")]
    InsufficientInventory,
    #[msg("Test USDC was already claimed by this wallet")]
    FaucetAlreadyClaimed,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
