import os
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import initialize_schema, seed_database
from app.routers import student, staff, admin



@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup and shutdown lifecycle manager.
    Initializes and seeds database on start.
    """
    initialize_schema()
    seed_database()
    yield

app = FastAPI(
    title="QueueCraft Backend (Python Migration)",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Mount API routers
app.include_router(student.router, prefix="/api/student", tags=["Student"])
app.include_router(staff.router, prefix="/api/staff", tags=["Staff"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])

# GET /api/health
@app.get("/api/health")
def get_health():
    """
    Exposes system health check matching the Node.js API format.
    """
    return {
        "status": "ok",
        "service": "QueueCraft Staff Operations Module",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    }

# Serving the built react frontend if dist directory exists
dist_path = os.path.join(os.getcwd(), "dist")
if os.path.exists(dist_path):
    # Map static files
    app.mount("/assets", StaticFiles(directory=os.path.join(dist_path, "assets")), name="assets")
    
    @app.get("/{fallback_path:path}")
    def serve_frontend_spa(fallback_path: str):
        # Allow endpoints beginning with /api to pass to 404 handler normally
        if fallback_path.startswith("api"):
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"message": f"API endpoint '/{fallback_path}' not found"}
            )
        
        index_file = os.path.join(dist_path, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
        
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={"message": "Frontend index.html asset is missing"}
        )

# Global error handler for JSON responses matching React client expectations
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"message": exc.detail, "error": exc.detail}
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"[Exception] Unhandled exception occurred: {str(exc)}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"message": "An internal server error occurred", "error": str(exc)}
    )

import socketio
from app.services.socket_service import sio
app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path='socket.io')

