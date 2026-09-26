use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, TransferChecked};
use crate::program::GpuMarket;

declare_id!("7M2BCLQXQpoGu4V8tcfZ4Hheu95kJfwYHyTVhUGhPPA5");

const TOKEN_DECIMALS: u8 = 6;
const SCALE: u128 = 1_000_000;
const BPS: u128 = 10_000;
const INDEX_SWAP_FEE_BPS: u128 = 30;

#[program]
pub mod gpu_market {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, fee_recipient: Pubkey) -> Result<()> {
        require!(ctx.accounts.quote_mint.decimals == TOKEN_DECIMALS, ExchangeError::InvalidQuoteMint);
        require!(fee_recipient != Pubkey::default(), ExchangeError::InvalidFeeRecipient);
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.oracle_authority = ctx.accounts.authority.key();
        config.quote_mint = ctx.accounts.quote_mint.key();
        config.fee_recipient = fee_recipient;
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

    pub fn set_authorities(
        ctx: Context<SetAuthorities>,
        new_authority: Pubkey,
        new_oracle_authority: Pubkey,
        new_fee_recipient: Pubkey,
    ) -> Result<()> {
        require!(
            new_authority != Pubkey::default()
                && new_oracle_authority != Pubkey::default()
                && new_fee_recipient != Pubkey::default(),
            ExchangeError::InvalidFeeRecipient
        );
        let config = &mut ctx.accounts.config;
        config.authority = new_authority;
        config.oracle_authority = new_oracle_authority;
        config.fee_recipient = new_fee_recipient;
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
        let fee = (quote_in as u128).checked_sub(effective).ok_or(ExchangeError::MathOverflow)?;
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
            to_u64(effective)?,
            TOKEN_DECIMALS,
        )?;

        if fee > 0 {
            token::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.user_quote.to_account_info(),
                        mint: ctx.accounts.quote_mint.to_account_info(),
                        to: ctx.accounts.fee_account.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                to_u64(fee)?,
                TOKEN_DECIMALS,
            )?;
        }

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
        let fee = to_u64(gross.checked_sub(quote_out as u128).ok_or(ExchangeError::MathOverflow)?)?;
        require!(
            quote_out >= minimum_quote_out && quote_out > 0,
            ExchangeError::SlippageExceeded
        );
        require!(
            ctx.accounts.quote_vault.amount >= to_u64(gross)?,
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
        if fee > 0 {
            token::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.quote_vault.to_account_info(),
                        mint: ctx.accounts.quote_mint.to_account_info(),
                        to: ctx.accounts.fee_account.to_account_info(),
                        authority: ctx.accounts.feed.to_account_info(),
                    },
                    &[signer],
                ),
                fee,
                TOKEN_DECIMALS,
            )?;
        }
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

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub quote_mint: Account<'info, Mint>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, GpuMarket>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()))]
    pub program_data: Account<'info, ProgramData>,
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
pub struct SetAuthorities<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
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
    #[account(mut, token::mint = quote_mint, token::authority = config.fee_recipient)]
    pub fee_account: Account<'info, TokenAccount>,
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
    #[account(mut, token::mint = quote_mint, token::authority = config.fee_recipient)]
    pub fee_account: Account<'info, TokenAccount>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub oracle_authority: Pubkey,
    pub quote_mint: Pubkey,
    pub fee_recipient: Pubkey,
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
#[error_code]
pub enum ExchangeError {
    #[msg("Quote mint must have six decimals")]
    InvalidQuoteMint,
    #[msg("Fee recipient cannot be the default address")]
    InvalidFeeRecipient,
    #[msg("Invalid symbol or name")]
    InvalidSymbol,
    #[msg("Invalid price")]
    InvalidPrice,
    #[msg("Invalid maximum age")]
    InvalidMaxAge,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Price feed is stale")]
    StalePrice,
    #[msg("Slippage limit exceeded")]
    SlippageExceeded,
    #[msg("The pool has insufficient bid liquidity")]
    InsufficientBidLiquidity,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
