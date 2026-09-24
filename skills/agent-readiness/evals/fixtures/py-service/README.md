# orders-api

Internal orders service.

## Dev

    docker compose up -d
    pip install -r requirements.txt
    cp .env.example .env
    uvicorn app.main:app --reload
