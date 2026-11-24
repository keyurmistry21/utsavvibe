.PHONY: up down db setup install logs admin demo demo-clear

# make up: start MySQL, sync schema, seed markets, then run API (:4000) + Next (:5173). Ctrl-C stops both.
# The steps live in scripts/dev.mjs so they also work on Windows (`npm run up` needs no make at all).
up:
	@node scripts/dev.mjs

install:
	@node scripts/dev.mjs --no-run

db:
	@docker compose up -d mysql mailpit

setup:
	@npm run db:push --silent
	@npm run seed --silent

# stop MySQL + mail catcher (data is kept in the Docker volume)
down:
	@docker compose stop mysql mailpit

logs:
	@docker compose logs -f mysql

# make admin EMAIL=you@x.com PASSWORD='long password' NAME='You'
admin:
	@npm run create-admin -- "$(EMAIL)" "$(PASSWORD)" "$(NAME)"

# sample products in all markets (UK/US/CA prices) so the storefront has content
demo:
	@npm -w backend run seed:demo --silent

demo-clear:
	@npm -w backend run seed:demo --silent -- --clear
