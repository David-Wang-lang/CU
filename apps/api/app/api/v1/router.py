from fastapi import APIRouter

from app.api.v1 import auth, devices, employees, health, monitoring, retention

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router)
api_router.include_router(employees.router)
api_router.include_router(devices.router)
api_router.include_router(monitoring.router)
api_router.include_router(retention.router)
