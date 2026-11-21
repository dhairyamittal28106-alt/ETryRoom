"""Durable, single-node product data and account API for ETryRoom."""
import base64
from email.message import EmailMessage
import hashlib
import hmac
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import quote, urlsplit

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("ETRYROOM_DB", ROOT / "data" / "etryroom.sqlite3"))
router = APIRouter(prefix="/api")
COOKIE = "etryroom_session"


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def init_store():
    with connect() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash BLOB NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,window_started TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS password_reset_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS password_reset_limits(email_hash TEXT PRIMARY KEY,count INTEGER NOT NULL,window_started TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,body_chest_cm REAL NOT NULL CHECK(body_chest_cm BETWEEN 50 AND 180),created_at TEXT NOT NULL,UNIQUE(user_id,name));
        CREATE TABLE IF NOT EXISTS garments(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,brand TEXT NOT NULL DEFAULT '',image_data TEXT NOT NULL DEFAULT '',measurement_source TEXT NOT NULL,created_at TEXT NOT NULL,source_url TEXT NOT NULL DEFAULT '',measurement_basis TEXT NOT NULL DEFAULT 'garment',garment_type TEXT NOT NULL DEFAULT 'tshirt');
        CREATE TABLE IF NOT EXISTS garment_sizes(id TEXT PRIMARY KEY,garment_id TEXT NOT NULL REFERENCES garments(id) ON DELETE CASCADE,label TEXT NOT NULL,chest_cm REAL NOT NULL CHECK(chest_cm BETWEEN 50 AND 220),length_cm REAL CHECK(length_cm IS NULL OR length_cm BETWEEN 30 AND 150),chest_min_cm REAL,chest_max_cm REAL,UNIQUE(garment_id,label));
        CREATE TABLE IF NOT EXISTS looks(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,image_data TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
        CREATE INDEX IF NOT EXISTS password_reset_expiry ON password_reset_tokens(expires_at);
        CREATE INDEX IF NOT EXISTS garments_owner ON garments(user_id,created_at);
        """)
        if "terms_accepted_at" not in {row["name"] for row in db.execute("PRAGMA table_info(users)")} :
            db.execute("ALTER TABLE users ADD COLUMN terms_accepted_at TEXT")
        if "is_published" not in {row["name"] for row in db.execute("PRAGMA table_info(garments)")}:
            db.execute("ALTER TABLE garments ADD COLUMN is_published INTEGER NOT NULL DEFAULT 0")
        if "source_url" not in {row["name"] for row in db.execute("PRAGMA table_info(garments)")}:
            db.execute("ALTER TABLE garments ADD COLUMN source_url TEXT NOT NULL DEFAULT ''")
        if "measurement_basis" not in {row["name"] for row in db.execute("PRAGMA table_info(garments)")}:
            db.execute("ALTER TABLE garments ADD COLUMN measurement_basis TEXT NOT NULL DEFAULT 'garment'")
        if "garment_type" not in {row["name"] for row in db.execute("PRAGMA table_info(garments)")}:
            db.execute("ALTER TABLE garments ADD COLUMN garment_type TEXT NOT NULL DEFAULT 'tshirt'")
        for column in ("chest_min_cm", "chest_max_cm"):
            if column not in {row["name"] for row in db.execute("PRAGMA table_info(garment_sizes)")}:
                db.execute(f"ALTER TABLE garment_sizes ADD COLUMN {column} REAL")
        profile_columns = {row["name"] for row in db.execute("PRAGMA table_info(profiles)")}
        for column in ("body_waist_cm", "body_hip_cm"):
            if column not in profile_columns:
                db.execute(f"ALTER TABLE profiles ADD COLUMN {column} REAL")
        for column in ("waist_cm", "hip_cm", "waist_min_cm", "waist_max_cm", "hip_min_cm", "hip_max_cm"):
            if column not in {row["name"] for row in db.execute("PRAGMA table_info(garment_sizes)")}:
                db.execute(f"ALTER TABLE garment_sizes ADD COLUMN {column} REAL")
        db.execute("UPDATE garments SET is_published=0 WHERE is_published=1 AND (source_url='' OR image_data='')")
        db.execute("CREATE INDEX IF NOT EXISTS published_garments ON garments(is_published,created_at)")


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=256)


class Registration(Credentials):
    accepted_privacy: bool = False


class PasswordResetRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class PasswordResetComplete(BaseModel):
    token: str = Field(min_length=32, max_length=128)
    password: str = Field(min_length=12, max_length=256)


class ProfileInput(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    body_chest_cm: float = Field(ge=50, le=180)
    body_waist_cm: float | None = Field(default=None, ge=40, le=180)
    body_hip_cm: float | None = Field(default=None, ge=40, le=180)


class SizeInput(BaseModel):
    label: str = Field(min_length=1, max_length=24)
    chest_cm: float | None = Field(default=None, ge=50, le=220)
    chest_min_cm: float | None = Field(default=None, ge=50, le=180)
    chest_max_cm: float | None = Field(default=None, ge=50, le=180)
    waist_cm: float | None = Field(default=None, ge=40, le=220)
    hip_cm: float | None = Field(default=None, ge=40, le=220)
    waist_min_cm: float | None = Field(default=None, ge=40, le=180)
    waist_max_cm: float | None = Field(default=None, ge=40, le=180)
    hip_min_cm: float | None = Field(default=None, ge=40, le=180)
    hip_max_cm: float | None = Field(default=None, ge=40, le=180)
    length_cm: float | None = Field(default=None, ge=30, le=150)


class GarmentInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    brand: str = Field(default="", max_length=80)
    source_url: str = Field(default="", max_length=2048)
    measurement_basis: Literal["garment", "body"] = "garment"
    garment_type: Literal["tshirt", "long_sleeve", "polo", "hoodie", "sweater", "outerwear"] = "tshirt"
    image_data: str = Field(default="", max_length=7_000_000)
    publish: bool = False
    publish_ack: bool = False
    sizes: list[SizeInput] = Field(min_length=1, max_length=30)


class LookInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    image_data: str = Field(min_length=1, max_length=7_000_000)


def user_id(session: Annotated[str | None, Cookie(alias=COOKIE)] = None):
    if not session:
        raise HTTPException(401, "Sign in to use your saved fitting room.")
    digest = hashlib.sha256(session.encode()).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        row = db.execute("SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?", (digest, now)).fetchone()
    if not row:
        raise HTTPException(401, "Your session expired. Please sign in again.")
    return row["user_id"]


User = Annotated[str, Depends(user_id)]


def password_hash(password: str, salt: bytes | None = None):
    salt = salt or secrets.token_bytes(16)
    return salt + hashlib.scrypt(password.encode(), salt=salt, n=2**15, r=8, p=1, dklen=32, maxmem=64 * 1024 * 1024)


def verify_password(password: str, saved: bytes):
    return hmac.compare_digest(password_hash(password, saved[:16]), saved)


def password_reset_mail_settings():
    host = os.getenv("ETRYROOM_SMTP_HOST", "").strip()
    sender = os.getenv("ETRYROOM_FROM_EMAIL", "").strip()
    public_url = os.getenv("ETRYROOM_PUBLIC_URL", "").strip().rstrip("/")
    parsed = urlsplit(public_url)
    if not host or not sender or parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
        raise HTTPException(503, "Password recovery email is not configured for this deployment.")
    username = os.getenv("ETRYROOM_SMTP_USERNAME", "").strip()
    password = os.getenv("ETRYROOM_SMTP_PASSWORD", "")
    if bool(username) != bool(password):
        raise HTTPException(503, "Password recovery email credentials are incomplete.")
    mode = os.getenv("ETRYROOM_SMTP_MODE", "starttls").lower()
    if mode not in ("starttls", "ssl"):
        raise HTTPException(503, "ETRYROOM_SMTP_MODE must be starttls or ssl.")
    try:
        port = int(os.getenv("ETRYROOM_SMTP_PORT", "465" if mode == "ssl" else "587"))
    except ValueError as exc:
        raise HTTPException(503, "ETRYROOM_SMTP_PORT must be a valid TCP port.") from exc
    if not 1 <= port <= 65535:
        raise HTTPException(503, "ETRYROOM_SMTP_PORT must be a valid TCP port.")
    return host, port, username, password, sender, public_url, mode


def send_password_reset_email(email: str, token: str, settings):
    host, port, username, password, sender, public_url, mode = settings
    # Keep the secret in a URL fragment so browsers never send it to the server
    # in access logs or a Referer header.
    link = f"{public_url}/#reset_token={quote(token)}"
    message = EmailMessage()
    message["Subject"] = "Reset your ETryRoom password"
    message["From"] = sender
    message["To"] = email
    message.set_content(
        "We received a request to reset your ETryRoom password.\n\n"
        f"Choose a new password using this one-time link (valid for 30 minutes):\n{link}\n\n"
        "If you did not request this, you can ignore this email."
    )
    context = ssl.create_default_context()
    smtp = smtplib.SMTP_SSL(host, port, timeout=12, context=context) if mode == "ssl" else smtplib.SMTP(host, port, timeout=12)
    with smtp:
        if mode == "starttls":
            smtp.starttls(context=context)
        if username:
            smtp.login(username, password)
        smtp.send_message(message)


def set_session(response: Response, uid: str):
    token = secrets.token_urlsafe(40)
    digest = hashlib.sha256(token.encode()).hexdigest()
    expiry = datetime.now(timezone.utc) + timedelta(days=14)
    with connect() as db:
        db.execute("DELETE FROM sessions WHERE expires_at<=?", (datetime.now(timezone.utc).isoformat(),))
        db.execute("INSERT INTO sessions VALUES(?,?,?)", (digest, uid, expiry.isoformat()))
    response.set_cookie(COOKIE, token, httponly=True, secure=os.getenv("ETRYROOM_COOKIE_SECURE", "0") == "1", samesite="lax", max_age=14 * 86400, path="/")


def validate_image_data(value: str, allow_empty=False):
    if not value and allow_empty:
        return
    match = re.fullmatch(r"data:image/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})", value)
    if not match:
        raise HTTPException(400, "Upload a PNG or JPEG image.")
    try:
        raw = base64.b64decode(match.group(1), validate=True)
    except ValueError as exc:
        raise HTTPException(400, "The image data is invalid.") from exc
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "Images must be 5 MB or smaller.")


def image_response(data: str, private: bool):
    match = re.fullmatch(r"data:image/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})", data)
    if not match:
        raise HTTPException(404, "Product image not found.")
    try:
        raw = base64.b64decode(match.group(2), validate=True)
    except ValueError as exc:
        raise HTTPException(404, "Product image not found.") from exc
    headers = {"Cache-Control": "private, no-store"} if private else {"Cache-Control": "public, max-age=3600"}
    return Response(content=raw, media_type=f"image/{match.group(1)}", headers=headers)


@router.post("/auth/register", status_code=201)
def register(body: Registration, response: Response):
    if not body.accepted_privacy:
        raise HTTPException(422, "Review and accept the privacy policy to create an account.")
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(422, "Enter a valid email address.")
    uid = secrets.token_urlsafe(18)
    try:
        with connect() as db:
            db.execute("INSERT INTO users(id,email,password_hash,created_at,terms_accepted_at) VALUES(?,?,?,?,?)", (uid, email, password_hash(body.password), datetime.now(timezone.utc).isoformat(), datetime.now(timezone.utc).isoformat()))
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "An account already exists for this email.") from exc
    set_session(response, uid)
    return {"id": uid, "email": email}


@router.post("/auth/login")
def login(body: Credentials, response: Response, request: Request):
    address = request.client.host if request.client else "unknown"
    attempt_key = hashlib.sha256(f"{address}:{body.email.strip().lower()}".encode()).hexdigest()
    now = datetime.now(timezone.utc)
    with connect() as db:
        attempt = db.execute("SELECT count,window_started FROM login_attempts WHERE key=?", (attempt_key,)).fetchone()
        if attempt and attempt["count"] >= 10 and now - datetime.fromisoformat(attempt["window_started"]) < timedelta(minutes=15):
            raise HTTPException(429, "Too many sign-in attempts. Wait 15 minutes and try again.")
        row = db.execute("SELECT id,email,password_hash FROM users WHERE email=?", (body.email.strip().lower(),)).fetchone()
    if not row or not verify_password(body.password, row["password_hash"]):
        with connect() as db:
            if attempt and now - datetime.fromisoformat(attempt["window_started"]) < timedelta(minutes=15):
                db.execute("UPDATE login_attempts SET count=count+1 WHERE key=?", (attempt_key,))
            else:
                db.execute("INSERT INTO login_attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=1,window_started=excluded.window_started", (attempt_key, 1, now.isoformat()))
        raise HTTPException(401, "Email or password is incorrect.")
    with connect() as db:
        db.execute("DELETE FROM login_attempts WHERE key=?", (attempt_key,))
    set_session(response, row["id"])
    return {"id": row["id"], "email": row["email"]}


@router.post("/auth/password-reset/request", status_code=202)
def request_password_reset(body: PasswordResetRequest):
    settings = password_reset_mail_settings()
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(422, "Enter a valid email address.")

    now = datetime.now(timezone.utc)
    email_key = hashlib.sha256(email.encode()).hexdigest()
    token = None
    with connect() as db:
        db.execute("DELETE FROM password_reset_tokens WHERE expires_at<=?", (now.isoformat(),))
        db.execute("DELETE FROM password_reset_limits WHERE window_started<=?", ((now - timedelta(days=1)).isoformat(),))
        attempt = db.execute("SELECT count,window_started FROM password_reset_limits WHERE email_hash=?", (email_key,)).fetchone()
        within_window = attempt and now - datetime.fromisoformat(attempt["window_started"]) < timedelta(minutes=15)
        allowed = not (within_window and attempt["count"] >= 3)
        if allowed:
            if within_window:
                db.execute("UPDATE password_reset_limits SET count=count+1 WHERE email_hash=?", (email_key,))
            else:
                db.execute("INSERT INTO password_reset_limits VALUES(?,?,?) ON CONFLICT(email_hash) DO UPDATE SET count=1,window_started=excluded.window_started", (email_key, 1, now.isoformat()))
            user = db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
            if user:
                token = secrets.token_urlsafe(32)
                token_hash = hashlib.sha256(token.encode()).hexdigest()
                expires = (now + timedelta(minutes=30)).isoformat()
                db.execute("INSERT INTO password_reset_tokens VALUES(?,?,?)", (token_hash, user["id"], expires))

    if token:
        try:
            send_password_reset_email(email, token, settings)
        except Exception as error:
            with connect() as db:
                db.execute("DELETE FROM password_reset_tokens WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
            print(f"Password reset email delivery failed ({type(error).__name__}).", flush=True)
    return {"status": "If an account exists and email delivery is available, a reset link will arrive shortly."}


@router.post("/auth/password-reset/complete")
def complete_password_reset(body: PasswordResetComplete):
    token_hash = hashlib.sha256(body.token.encode()).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        token = db.execute("SELECT user_id FROM password_reset_tokens WHERE token_hash=? AND expires_at>?", (token_hash, now)).fetchone()
        if not token:
            raise HTTPException(400, "This password reset link is invalid or has expired. Request a new link.")
        db.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash(body.password), token["user_id"]))
        db.execute("DELETE FROM sessions WHERE user_id=?", (token["user_id"],))
        db.execute("DELETE FROM password_reset_tokens WHERE user_id=?", (token["user_id"],))
    return {"status": "password_updated"}


@router.post("/auth/logout")
def logout(response: Response, session: Annotated[str | None, Cookie(alias=COOKIE)] = None):
    if session:
        with connect() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(session.encode()).hexdigest(),))
    response.delete_cookie(COOKIE, path="/")
    return {"status": "signed_out"}


@router.get("/auth/me")
def me(uid: User):
    with connect() as db:
        profiles = db.execute("SELECT id,name,body_chest_cm,body_waist_cm,body_hip_cm FROM profiles WHERE user_id=? ORDER BY created_at", (uid,)).fetchall()
        account = db.execute("SELECT email FROM users WHERE id=?", (uid,)).fetchone()
    return {"id": uid, "email": account["email"], "profiles": [dict(p) for p in profiles]}


@router.get("/profiles")
def list_profiles(uid: User):
    with connect() as db:
        rows = db.execute("SELECT id,name,body_chest_cm,body_waist_cm,body_hip_cm FROM profiles WHERE user_id=? ORDER BY created_at", (uid,)).fetchall()
    return [dict(row) for row in rows]


@router.post("/profiles", status_code=201)
def save_profile(body: ProfileInput, uid: User):
    pid = secrets.token_urlsafe(16)
    with connect() as db:
        db.execute("INSERT INTO profiles(id,user_id,name,body_chest_cm,created_at,body_waist_cm,body_hip_cm) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,name) DO UPDATE SET body_chest_cm=excluded.body_chest_cm,body_waist_cm=excluded.body_waist_cm,body_hip_cm=excluded.body_hip_cm", (pid, uid, body.name.strip(), body.body_chest_cm, datetime.now(timezone.utc).isoformat(), body.body_waist_cm, body.body_hip_cm))
        row = db.execute("SELECT id,name,body_chest_cm,body_waist_cm,body_hip_cm FROM profiles WHERE user_id=? AND name=?", (uid, body.name.strip())).fetchone()
    return dict(row)


@router.get("/garments")
def list_garments(uid: User):
    with connect() as db:
        garments = db.execute("SELECT * FROM garments WHERE user_id=? ORDER BY created_at DESC", (uid,)).fetchall()
        result = []
        for garment in garments:
            item = dict(garment)
            item["has_image"] = bool(item.pop("image_data", ""))
            item["image_url"] = f"/api/garments/{item['id']}/image" if item["has_image"] else ""
            item["sizes"] = [dict(row) for row in db.execute("SELECT label,chest_cm,length_cm,chest_min_cm,chest_max_cm,waist_cm,hip_cm,waist_min_cm,waist_max_cm,hip_min_cm,hip_max_cm FROM garment_sizes WHERE garment_id=? ORDER BY chest_cm", (item["id"],))]
            result.append(item)
    return result


def public_garment(row, db):
    item = dict(row)
    item["has_image"] = True
    item["image_url"] = f"/api/catalog/{item['id']}/image"
    item["sizes"] = [dict(size) for size in db.execute("SELECT label,chest_cm,length_cm,chest_min_cm,chest_max_cm,waist_cm,hip_cm,waist_min_cm,waist_max_cm,hip_min_cm,hip_max_cm FROM garment_sizes WHERE garment_id=? ORDER BY chest_cm", (item["id"],))]
    return item


@router.get("/catalog")
def browse_catalog(q: str = "", limit: int = 60, offset: int = 0):
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    query = f"%{q.strip()[:80]}%"
    with connect() as db:
        rows = db.execute("SELECT id,name,brand,measurement_source,created_at,source_url,measurement_basis,garment_type FROM garments WHERE is_published=1 AND (name LIKE ? OR brand LIKE ?) ORDER BY created_at DESC LIMIT ? OFFSET ?", (query, query, limit, offset)).fetchall()
        return [public_garment(row, db) for row in rows]


@router.get("/catalog/{garment_id}")
def get_public_garment(garment_id: str):
    with connect() as db:
        row = db.execute("SELECT id,name,brand,measurement_source,created_at,source_url,measurement_basis,garment_type FROM garments WHERE id=? AND is_published=1", (garment_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Published size guide not found.")
        return public_garment(row, db)


@router.get("/catalog/{garment_id}/image")
def get_public_garment_image(garment_id: str):
    with connect() as db:
        row = db.execute("SELECT image_data FROM garments WHERE id=? AND is_published=1", (garment_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Published product image not found.")
    return image_response(row["image_data"], private=False)


@router.get("/garments/{garment_id}/image")
def get_private_garment_image(garment_id: str, uid: User):
    with connect() as db:
        row = db.execute("SELECT image_data FROM garments WHERE id=? AND user_id=?", (garment_id, uid)).fetchone()
    if not row:
        raise HTTPException(404, "Product image not found.")
    return image_response(row["image_data"], private=True)


@router.post("/garments", status_code=201)
def save_garment(body: GarmentInput, uid: User):
    if body.image_data:
        validate_image_data(body.image_data)
    if body.publish and not body.image_data:
        raise HTTPException(422, "Published shopping items need a product image for the fitting studio.")
    source_url = body.source_url.strip()
    if body.publish and not re.fullmatch(r"https://[^\s]+", source_url, re.IGNORECASE):
        raise HTTPException(422, "Published guides need an HTTPS link to the source size chart.")
    if body.publish and not body.publish_ack:
        raise HTTPException(422, "Confirm that you have the right to publish this product photo and size information.")
    if source_url and not re.fullmatch(r"https://[^\s]+", source_url, re.IGNORECASE):
        raise HTTPException(422, "Source links must use HTTPS.")
    for size in body.sizes:
        if body.measurement_basis == "garment" and (size.chest_cm is None or size.chest_min_cm is not None or size.chest_max_cm is not None or any(value is not None for value in (size.waist_min_cm, size.waist_max_cm, size.hip_min_cm, size.hip_max_cm))):
            raise HTTPException(422, "Garment charts need garment circumferences, not body ranges.")
        if body.measurement_basis == "body" and (size.chest_min_cm is None or size.chest_max_cm is None or size.chest_min_cm > size.chest_max_cm or size.chest_cm is not None or size.waist_cm is not None or size.hip_cm is not None):
            raise HTTPException(422, "Body charts need a minimum and maximum body chest measurement per size.")
        if (size.waist_min_cm is None) != (size.waist_max_cm is None) or (size.hip_min_cm is None) != (size.hip_max_cm is None):
            raise HTTPException(422, "Enter both minimum and maximum values for each body measurement range.")
        if (size.waist_min_cm is not None and size.waist_min_cm > size.waist_max_cm) or (size.hip_min_cm is not None and size.hip_min_cm > size.hip_max_cm):
            raise HTTPException(422, "Body measurement ranges must be in ascending order.")
    if len({s.label.strip().casefold() for s in body.sizes}) != len(body.sizes):
        raise HTTPException(422, "Size labels must be unique for this garment.")
    if any(not s.label.strip() for s in body.sizes):
        raise HTTPException(422, "Every size needs a label.")
    chart_dimensions = ("waist_cm", "hip_cm") if body.measurement_basis == "garment" else ("waist_min_cm", "waist_max_cm", "hip_min_cm", "hip_max_cm")
    for field in chart_dimensions:
        count = sum(getattr(size, field) is not None for size in body.sizes)
        if count not in (0, len(body.sizes)):
            raise HTTPException(422, "Enter the same measurement columns for every size in a chart.")
    gid = secrets.token_urlsafe(16)
    with connect() as db:
        source = ("Seller-entered body size chart; source supplied by seller" if body.measurement_basis == "body" else "Seller-entered garment measurements; source supplied by seller") if body.publish else "Private user-entered size chart"
        db.execute("INSERT INTO garments(id,user_id,name,brand,image_data,measurement_source,created_at,is_published,source_url,measurement_basis,garment_type) VALUES(?,?,?,?,?,?,?,?,?,?,?)", (gid, uid, body.name.strip(), body.brand.strip(), body.image_data, source, datetime.now(timezone.utc).isoformat(), int(body.publish), source_url, body.measurement_basis, body.garment_type))
        db.executemany("INSERT INTO garment_sizes(id,garment_id,label,chest_cm,length_cm,chest_min_cm,chest_max_cm,waist_cm,hip_cm,waist_min_cm,waist_max_cm,hip_min_cm,hip_max_cm) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", [(secrets.token_urlsafe(12), gid, s.label.strip(), s.chest_cm if s.chest_cm is not None else round((s.chest_min_cm + s.chest_max_cm) / 2, 1), s.length_cm, s.chest_min_cm, s.chest_max_cm, s.waist_cm, s.hip_cm, s.waist_min_cm, s.waist_max_cm, s.hip_min_cm, s.hip_max_cm) for s in body.sizes])
    return {"id": gid, "name": body.name.strip(), "brand": body.brand.strip(), "has_image": bool(body.image_data), "image_url": f"/api/garments/{gid}/image" if body.image_data else "", "sizes": [s.model_dump() | ({"chest_cm": round((s.chest_min_cm + s.chest_max_cm) / 2, 1)} if s.chest_cm is None else {}) for s in body.sizes], "measurement_source": source, "source_url": source_url, "measurement_basis": body.measurement_basis, "garment_type": body.garment_type, "is_published": body.publish}


@router.delete("/garments/{garment_id}", status_code=204)
def delete_garment(garment_id: str, uid: User):
    with connect() as db:
        cursor = db.execute("DELETE FROM garments WHERE id=? AND user_id=?", (garment_id, uid))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Garment not found.")


# A fit recommendation only reads the saved profile and size chart. Keep this
# aligned with the fitting desk's GET request and allow shareable browser URLs.
@router.get("/fit/{garment_id}")
def recommend_fit(garment_id: str, profile_id: str, preference: str, uid: User):
    targets = {"snug": 3.0, "regular": 8.0, "relaxed": 14.0}
    if preference not in targets:
        raise HTTPException(422, "Choose snug, regular, or relaxed.")
    with connect() as db:
        profile = db.execute("SELECT body_chest_cm,body_waist_cm,body_hip_cm FROM profiles WHERE id=? AND user_id=?", (profile_id, uid)).fetchone()
        garment = db.execute("SELECT id,name,measurement_source,measurement_basis,source_url FROM garments WHERE id=? AND (user_id=? OR is_published=1)", (garment_id, uid)).fetchone()
        if not profile or not garment:
            raise HTTPException(404, "Profile or garment not found.")
        sizes = db.execute("SELECT label,chest_cm,length_cm,chest_min_cm,chest_max_cm,waist_cm,hip_cm,waist_min_cm,waist_max_cm,hip_min_cm,hip_max_cm FROM garment_sizes WHERE garment_id=? ORDER BY chest_cm", (garment_id,)).fetchall()
    dimensions = (
        ("chest", "body_chest_cm", "chest_cm", "chest_min_cm", "chest_max_cm"),
        ("waist", "body_waist_cm", "waist_cm", "waist_min_cm", "waist_max_cm"),
        ("hip", "body_hip_cm", "hip_cm", "hip_min_cm", "hip_max_cm"),
    )
    profile_values = {name: profile[profile_field] for name, profile_field, *_ in dimensions}
    if garment["measurement_basis"] == "body":
        chart_dimensions = [dimension for dimension in dimensions if any(size[dimension[3]] is not None and size[dimension[4]] is not None for size in sizes)]
        missing = [name for name, profile_field, *_ in chart_dimensions if profile[profile_field] is None]
        ranked = []
        for size in sizes:
            item = dict(size)
            dimension_distances = {}
            contains = True
            total_distance = 0.0
            for name, profile_field, _, minimum, maximum in chart_dimensions:
                low, high = size[minimum], size[maximum]
                if low is None or high is None or profile[profile_field] is None:
                    continue
                measurement = profile[profile_field]
                distance = max(low - measurement, measurement - high, 0)
                dimension_distances[name] = round(distance, 1)
                total_distance += distance
                contains = contains and distance == 0
            item["dimension_distances"] = dimension_distances
            item["distance_cm"] = round(total_distance, 1)
            item["contains_chest"] = profile["body_chest_cm"] >= item["chest_min_cm"] and profile["body_chest_cm"] <= item["chest_max_cm"]
            item["contains_measurements"] = contains and not missing
            ranked.append(item)
        ranked.sort(key=lambda item: (item["distance_cm"], item["chest_max_cm"] - item["chest_min_cm"]))
        if not ranked:
            raise HTTPException(422, "This garment has no measured size chart yet.")
        best = ranked[0]
        recommended = best["label"] if best["contains_measurements"] else None
        if missing:
            message = "Add your " + " and ".join(missing) + " measurement" + ("s" if len(missing) > 1 else "") + " to compare every dimension in this body-size chart."
        elif recommended:
            message = f"Your measurements fit inside all listed body ranges for size {best['label']}."
        else:
            message = f"No listed body-size row contains all your measurements. The closest row is {best['label']} with {best['distance_cm']:g} cm total outside its listed ranges."
        return {"garment": garment["name"], "profile_chest_cm": profile["body_chest_cm"], "profile_measurements_cm": profile_values, "preference": "body chart", "target_ease_cm": None, "recommended_size": recommended, "ease_cm": None, "measurement_basis": "body", "measurement_source": garment["measurement_source"], "source_url": garment["source_url"], "missing_measurements": missing, "message": message, "size_comparison": ranked}
    chart_dimensions = [dimension for dimension in dimensions if any(size[dimension[2]] is not None for size in sizes)]
    missing = [name for name, profile_field, *_ in chart_dimensions if profile[profile_field] is None]
    targets_by_dimension = {"chest": targets[preference], "waist": {"snug": 2.0, "regular": 6.0, "relaxed": 12.0}[preference], "hip": {"snug": 3.0, "regular": 8.0, "relaxed": 14.0}[preference]}
    ranked = []
    for size in sizes:
        item = dict(size)
        dimension_eases, distances = {}, []
        all_positive = True
        for name, profile_field, garment_field, *_ in chart_dimensions:
            if size[garment_field] is None or profile[profile_field] is None:
                continue
            ease = round(size[garment_field] - profile[profile_field], 1)
            dimension_eases[name] = ease
            distances.append(abs(ease - targets_by_dimension[name]))
            all_positive = all_positive and ease >= 0
        item["dimension_eases_cm"] = dimension_eases
        item["ease_cm"] = dimension_eases.get("chest")
        item["distance_cm"] = round(sum(distances) / len(distances), 1) if distances else 0
        item["positive_ease_all_dimensions"] = all_positive and len(dimension_eases) == len(chart_dimensions)
        ranked.append(item)
    ranked.sort(key=lambda item: item["distance_cm"])
    if not ranked:
        raise HTTPException(422, "This garment has no measured size chart yet.")
    best = ranked[0]
    recommended = best["label"] if best["positive_ease_all_dimensions"] and not missing else None
    if missing:
        message = "Add your " + " and ".join(missing) + " measurement" + ("s" if len(missing) > 1 else "") + " to compare every dimension in this garment chart."
    elif recommended:
        message = f"Size {best['label']} is closest to your {preference} ease preference across {len(chart_dimensions)} measured dimension" + ("s." if len(chart_dimensions) != 1 else ".")
    else:
        message = "No listed size provides non-negative ease across every measured dimension. Try another size or recheck the measurements."
    target_eases = {name: targets_by_dimension[name] for name, *_ in chart_dimensions}
    return {"garment": garment["name"], "profile_chest_cm": profile["body_chest_cm"], "profile_measurements_cm": profile_values, "preference": preference, "target_ease_cm": targets[preference], "target_eases_cm": target_eases, "recommended_size": recommended, "ease_cm": best["ease_cm"], "measurement_basis": "garment", "measurement_source": garment["measurement_source"], "source_url": garment["source_url"], "missing_measurements": missing, "message": message, "size_comparison": ranked}


@router.get("/looks")
def list_looks(uid: User):
    with connect() as db:
        rows = db.execute("SELECT id,name,created_at FROM looks WHERE user_id=? ORDER BY created_at DESC", (uid,)).fetchall()
    return [{**dict(row), "image_url": f"/api/looks/{row['id']}/image"} for row in rows]


@router.get("/looks/{look_id}/image")
def get_look_image(look_id: str, uid: User):
    with connect() as db:
        row = db.execute("SELECT image_data FROM looks WHERE id=? AND user_id=?", (look_id, uid)).fetchone()
    if not row:
        raise HTTPException(404, "Saved look image not found.")
    return image_response(row["image_data"], private=True)


@router.post("/looks", status_code=201)
def save_look(body: LookInput, uid: User):
    validate_image_data(body.image_data)
    lid = secrets.token_urlsafe(16)
    created = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        count = db.execute("SELECT COUNT(*) FROM looks WHERE user_id=?", (uid,)).fetchone()[0]
        if count >= 100:
            raise HTTPException(409, "Delete a saved look before saving another.")
        db.execute("INSERT INTO looks VALUES(?,?,?,?,?)", (lid, uid, body.name, body.image_data, created))
    return {"id": lid, "name": body.name, "created_at": created, "image_url": f"/api/looks/{lid}/image"}


@router.delete("/looks/{look_id}", status_code=204)
def delete_look(look_id: str, uid: User):
    with connect() as db:
        cursor = db.execute("DELETE FROM looks WHERE id=? AND user_id=?", (look_id, uid))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Saved look not found.")


@router.delete("/account", status_code=204)
def delete_account(uid: User):
    with connect() as db:
        db.execute("DELETE FROM users WHERE id=?", (uid,))
