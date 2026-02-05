from fastapi import FastAPI, APIRouter
from fastmcp import FastMCP

from control_panel_api.config import settings

# Create MCP server for agent tool discovery
mcp = FastMCP("ModelGuide")

# Create MCP ASGI app
mcp_app = mcp.http_app()

# Create FastAPI with MCP lifespan for proper session management
app = FastAPI(
    title=settings.app_name,
    lifespan=mcp_app.lifespan,
)

# Mount MCP at /mcp endpoint
app.mount("/mcp", mcp_app)

# API router for REST endpoints
api_router = APIRouter(prefix="/api")


@api_router.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


app.include_router(api_router)
