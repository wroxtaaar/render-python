import asyncio
import html
import re
from urllib.parse import quote, urljoin

import httpx

HOSTS = [
    "https://www.1337xx.to",
    "https://1337x.to",
    "https://1337x.st",
    "https://x1337x.ws",
]
_last_good = HOSTS[0]
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/142 Safari/537.36"


def clean(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]*>", "", value)).strip()


def size_bytes(value: str) -> int:
    match = re.search(
        r"([0-9]+(?:.[0-9]+)?)s*(B|KB|MB|GB|TB)",
        value.replace(",", ""),
        re.I,
    )
    if not match:
        return 0

    units = {"B": 1, "KB": 1024, "MB": 1024**2, "GB": 1024**3, "TB": 1024**4}
    return round(float(match.group(1)) * units[match.group(2).upper()])


async def fetch(path: str):
    global _last_good
    hosts = [_last_good] + [host for host in HOSTS if host != _last_good]

    async with httpx.AsyncClient(
        timeout=7,
        follow_redirects=True,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml",
        },
    ) as client:
        last_error = None

        for base in hosts:
            try:
                response = await client.get(
                    base + path,
                    headers={"Referer": base + "/"},
                )

                if response.status_code == 200:
                    _last_good = base
                    return base, response.text

                last_error = RuntimeError(f"HTTP {response.status_code}")
            except Exception as exc:
                last_error = exc

        raise last_error or RuntimeError("No 1337x mirror reachable")


def parse_rows(page: str, category: str):
    results = []

    for row in re.findall(r"<tr[sS]*?</tr>", page, re.I):
        match = re.search(
            r'class=["'][^"']*coll-1s+name[^"']*["'][sS]*?'
            r'<a[^>]+href=["'](/torrent/[^"']+)["'][^>]*>([sS]*?)</a>',
            row,
            re.I,
        )
        if not match:
            continue

        def field(class_name: str) -> str:
            found = re.search(
                r'class=["'][^"']*' + class_name +
                r'[^"']*["'][^>]*>([sS]*?)</td>',
                row,
                re.I,
            )
            return clean(found.group(1)) if found else ""

        try:
            seeders = int(field(r"coll-2s+seeds") or 0)
        except ValueError:
            seeders = 0

        try:
            leechers = int(field(r"coll-3s+leeches") or 0)
        except ValueError:
            leechers = 0

        results.append(
            {
                "title": clean(match.group(2)),
                "size": size_bytes(field(r"coll-4s+size")),
                "seeders": seeders,
                "leechers": leechers,
                "category": category,
                "page": match.group(1),
            }
        )

    return results


async def fetch_detail(client: httpx.AsyncClient, base: str, item: dict):
    try:
        response = await client.get(
            urljoin(base, item["page"]),
            headers={"Referer": base + "/"},
        )

        if response.status_code != 200:
            return None

        match = re.search(
            r'href=["'](magnet:?[^"']+)["']',
            response.text,
            re.I,
        )
        if not match:
            return None

        magnet = html.unescape(match.group(1))
        hash_match = re.search(
            r"(?:^|[?&])xt=urn:btih:([a-z0-9]{40})",
            magnet,
            re.I,
        )
        info_url = urljoin(base, item["page"])

        return {
            "guid": info_url,
            "title": item["title"],
            "size": item["size"],
            "seeders": item["seeders"],
            "leechers": item["leechers"],
            "category": item["category"],
            "indexer": "1337x",
            "protocol": "torrent",
            "magnetUrl": magnet,
            "infoHash": hash_match.group(1).lower() if hash_match else None,
            "infoUrl": info_url,
            "sourceUrl": info_url,
        }
    except Exception:
        return None


async def search_1337x(query: str, limit: int = 10):
    encoded = quote(query).replace("%20", "+")

    async def search_category(category: str):
        try:
            return category, await fetch(
                f"/category-search/{encoded}/{category}/1/"
            )
        except Exception:
            return category, None

    pages = await asyncio.gather(
        search_category("Movies"),
        search_category("TV"),
    )

    tokens = [
        token
        for token in re.split(r"s+", query.lower())
        if token and token not in {"the", "a", "an", "of", "and"}
    ]

    candidates = []

    for category, result in pages:
        if not result:
            continue

        base, page = result

        for item in parse_rows(page, category):
            if all(token in item["title"].lower() for token in tokens):
                item["base"] = base
                candidates.append(item)

    unique = {item["page"].lower(): item for item in candidates}

    top = sorted(
        unique.values(),
        key=lambda item: item["seeders"],
        reverse=True,
    )[: max(1, min(limit, 10))]

    async with httpx.AsyncClient(
        timeout=7,
        follow_redirects=True,
        headers={"User-Agent": UA},
    ) as client:
        results = await asyncio.gather(
            *(fetch_detail(client, item["base"], item) for item in top)
        )

    return [result for result in results if result]
