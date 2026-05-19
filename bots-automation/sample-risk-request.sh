# Optional: add "sec-ch-ua" next to "user-agent" (lowercase keys) for Bot-by-service-worker hints.
curl --location 'localhost:8080/v1/risk/signals' \
--header 'X-Correlation-Id: a255226c-d466-478e-836c-39baa78e47b9' \
--header 'Content-Type: application/json' \
--data '{
    "payload": "UDI-payload",
    "httpHeaders": {
        "user-agent": "user-agent"
    },
    "ip": "185.212.107.9"
}'