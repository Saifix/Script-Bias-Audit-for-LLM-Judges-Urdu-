up:
	docker compose up --build -d

down:
	docker compose down

test:
	docker compose build backend frontend-test
	docker compose run --rm --no-deps backend pytest
	docker compose --profile test run --rm frontend-test

logs:
	docker compose logs -f

.PHONY: up down test logs
