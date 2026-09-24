import os

from fastapi import FastAPI
from sqlalchemy import create_engine, text

engine = create_engine(os.environ["DATABASE_URL"])
app = FastAPI()


@app.get("/orders/{order_id}")
def get_order(order_id: int) -> dict[str, object]:
    with engine.connect() as conn:
        row = conn.execute(text("select id, total from orders where id = :id"), {"id": order_id}).one()
    return {"id": row.id, "total": row.total}
