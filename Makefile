.PHONY: up down db wait setup install logs admin demo demo-clear

# make up: start MySQL, sync schema, seed markets, then run API (:4000) + Next (:5173). Ctrl-C stops both.
up: install db wait setup
	@echo "API  -> http://localhost:4000"
	@echo "Site -> http://localhost:5173  (admin: /admin)"
	@echo "Mail -> http://localhost:8026  (dev inbox)"
	@trap 'kill 0' INT TERM EXIT; \
	npm run dev:server & \
	npm run dev:web & \
	wait

install:
	@[ -d node_modules ] || npm install
	@[ -f backend/.env ] || cp backend/.env.example backend/.env

db:
	@docker compose up -d mysql mailpit

# TCP ping (not socket): the init-time temp server only listens on the socket.
wait:
	@printf "waiting for MySQL"; \
	until docker exec utsavvibe-mysql mysqladmin ping -h127.0.0.1 -uroot -proot --silent >/dev/null 2>&1; do printf "."; sleep 2; done; echo " ready"

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
