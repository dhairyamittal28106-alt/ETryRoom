"""Create and rotate consistent SQLite backups for the ETryRoom data volume."""
import argparse
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path


def create_backup(database: Path, backup_dir: Path, retain: int) -> Path:
    if not database.is_file():
        raise FileNotFoundError(f"Database not found: {database}")

    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = backup_dir / f"etryroom-{stamp}.sqlite3"
    temporary = destination.with_suffix(".sqlite3.tmp")

    try:
        with sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True) as source:
            with sqlite3.connect(temporary) as target:
                source.backup(target)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)

    backups = sorted(backup_dir.glob("etryroom-*.sqlite3"), key=lambda path: path.stat().st_mtime, reverse=True)
    for old_backup in backups[retain:]:
        old_backup.unlink()
    print(f"Created {destination}", flush=True)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path(os.getenv("ETRYROOM_DB", "/data/etryroom.sqlite3")))
    parser.add_argument("--directory", type=Path, default=Path("/backups"))
    parser.add_argument("--interval", type=int, default=86400, help="Seconds between backups")
    parser.add_argument("--retain", type=int, default=14, help="Number of recent backups to keep")
    args = parser.parse_args()
    if args.interval < 60 or args.retain < 1:
        parser.error("--interval must be at least 60 seconds and --retain must be at least 1")

    while True:
        try:
            create_backup(args.database, args.directory, args.retain)
        except Exception as error:
            print(f"Backup failed: {error}", flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
