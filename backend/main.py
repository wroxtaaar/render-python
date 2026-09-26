import asyncio
import os
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .search1337x import search_1337x

SEEDR_BASE = "https://www.seedr.cc/api/v0.1/p"
SEEDR_TOKEN = os.getenv("SEEDR_API_TOKEN", "").strip()
SEEDR_FOLDER_ID = os.getenv("SEEDR_LIBRARY_FOLDER_ID", "").strip()

try:
    SEEDR_MAX_SIZE_BYTES = int(float(os.getenv("SEEDR_MAX_SIZE_GB", "5")) * 1024**3)
except ValueError:
    SEEDR_MAX_SIZE_BYTES = 5 * 1024**3

DIST = Path(__file__).resolve().parent.parent / "dist"
app = FastAPI(title="SeedFlow")


class AddRequest(BaseModel):
    magnet: str
    size: int | None = None
    folder_id: str | None = None


async def seedr_request(method: str, path: str, **kwargs):
    if not SEEDR_TOKEN:
        raise HTTPException(503, "SEEDR_API_TOKEN is not configured")

    headers = {
        "Authorization": f"Bearer {SEEDR_TOKEN}",
        "Accept": "application/json",
    }
    headers.update(kwargs.pop("headers", {}) or {})

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.request(
            method,
            SEEDR_BASE + path,
            headers=headers,
            **kwargs,
        )

    if response.status_code >= 400:
        raise HTTPException(
            response.status_code,
            response.text[:1000] or "Seedr request failed",
        )

    try:
        return response.json()
    except Exception:
        return {"raw": response.text}


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/search")
async def search(q: str, limit: int = 10):
    query = q.strip()
    if not query:
        return []

    try:
        return await search_1337x(query, max(1, min(limit, 20)))
    except Exception as exc:
        raise HTTPException(502, f"1337x search failed: {exc}")


@app.get("/api/seedr/quota")
async def quota():
    data = await seedr_request("GET", "/user")

    storage = data.get("account", {}).get("storage") or data.get("storage") or {}

    maximum = int(
        storage.get("limit")
        or storage.get("max_space")
        or data.get("space_max")
        or 0
    )
    used = int(
        storage.get("used")
        or storage.get("used_space")
        or data.get("space_used")
        or 0
    )

    if maximum <= 0 or used < 0 or used > maximum:
        raise HTTPException(502, "Seedr quota information is unavailable")

    return {
        "configured": True,
        "maxSpace": maximum,
        "usedSpace": used,
        "remainingSpace": max(0, maximum - used),
        "premium": bool(data.get("is_premium", False)),
    }


@app.post("/api/seedr/add")
async def add(request: AddRequest):
    if not request.magnet.startswith("magnet:?"):
        raise HTTPException(400, "A valid magnet URL is required")

    if request.size is not None and request.size > SEEDR_MAX_SIZE_BYTES:
        raise HTTPException(413, "Torrent exceeds the configured Seedr size limit")

    folder_id = (request.folder_id or SEEDR_FOLDER_ID).strip()
    if not folder_id or not folder_id.isdigit():
        raise HTTPException(500, "SEEDR_LIBRARY_FOLDER_ID must be configured")

    return await seedr_request(
        "POST",
        "/tasks",
        data={
            "torrent_magnet": request.magnet,
            "folder_id": folder_id,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )


@app.get("/api/seedr/tasks")
async def tasks():
    return await seedr_request("GET", "/tasks")


@app.get("/api/seedr/tasks/{task_id}")
async def task(task_id: str):
    data = await seedr_request(
        "GET",
        "/tasks/" + quote(task_id, safe=""),
    )

    try:
        progress = float(data.get("progress", 0) or 0)
    except (TypeError, ValueError):
        progress = 0

    state = str(data.get("state", data.get("status", ""))).lower()
    done = state in {"finished", "completed", "complete"} or progress >= 100

    return {
        "task": data,
        "status": "completed" if done else "downloading",
        "progress": max(0, min(100, progress)),
    }


async def seedr_list_folder(folder_id: str):
    return await seedr_request(
        "POST",
        "/list_contents",
        data={"content_type": "folder", "content_id": str(folder_id)},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )


@app.get("/api/seedr/files")
async def files():
    folder_id = SEEDR_FOLDER_ID.strip()
    if not folder_id or not folder_id.isdigit():
        raise HTTPException(500, "SEEDR_LIBRARY_FOLDER_ID must be configured")

    # Completed torrents are commonly represented by folders in Seedr.
    # Walk the configured library folder recursively so the UI sees the
    # actual files inside those torrent folders.
    seen: set[str] = set()
    collected: list[dict] = []

    async def walk(current_id: str, path: str):
        if current_id in seen:
            return
        seen.add(current_id)
        data = await seedr_list_folder(current_id)
        current_path = path or str(data.get("name") or "")

        for item in data.get("files") or []:
            if not isinstance(item, dict):
                continue
            file_id = item.get("folder_file_id") or item.get("id")
            if file_id is None:
                continue
            collected.append({
                "id": str(file_id),
                "name": item.get("name") or "Unnamed file",
                "size": int(item.get("size") or 0),
                "folderId": str(current_id),
                "folderPath": current_path or "/",
                "url": None,
            })

        children = data.get("folders") or []
        await asyncio.gather(*[
            walk(
                str(child.get("id")),
                f"{current_path}/{child.get('name', '')}".replace("//", "/"),
            )
            for child in children
            if isinstance(child, dict) and child.get("id") is not None
        ])

    try:
        await walk(folder_id, "")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Seedr library lookup failed: {exc}")

    return {"files": collected, "count": len(collected), "folderId": folder_id}


@app.get("/api/seedr/files/{file_id}/download")
async def file_download(file_id: str):
    if not file_id.isdigit():
        raise HTTPException(400, "Invalid Seedr file ID")
    return await seedr_request(
        "POST",
        "/fetch_file",
        data={"folder_file_id": file_id},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

@app.delete("/api/seedr/tasks/{task_id}")
async def delete_task(task_id: str):
    return await seedr_request(
        "DELETE",
        "/tasks/" + quote(task_id, safe=""),
    )


@app.get("/{path:path}")
async def frontend(path: str):
    target = DIST / path if path else DIST / "index.html"

    if target.is_file():
        return FileResponse(target)

    index = DIST / "index.html"
    if index.is_file():
        return FileResponse(index)

    raise HTTPException(404, "Frontend not built")
