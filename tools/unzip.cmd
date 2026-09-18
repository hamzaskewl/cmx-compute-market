@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%~2' -DestinationPath '%~4' -Force"
