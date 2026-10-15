from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.config import settings
from backend.app.api import routes_llm, routes_chat, routes_anatomy

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="0.1.0",
    description="HoloMed 3D Literature-Grounded Anatomy & Pathology AI Tutor API"
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(routes_llm.router)
app.include_router(routes_chat.router)
app.include_router(routes_anatomy.router)


@app.get("/api/v1/health")
async def health_check():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "environment": settings.ENVIRONMENT,
        "features": {
            "openai_compat_gateway": True,
            "anatomy_registry": True,
            "rag_streaming": True
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
