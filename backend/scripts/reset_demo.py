"""Wipes a database and (optionally) fills it with a fake demo gym: one login for every role.

DESTRUCTIVE: every gym, member, payment and login in the target database is deleted.

    # Wipe and fill with demo accounts (random passwords, printed once at the end):
    DATABASE_URL=<external database url> python scripts/reset_demo.py --yes

    # Wipe only, leaving an empty database (sign up fresh afterwards):
    DATABASE_URL=<external database url> python scripts/reset_demo.py --yes --wipe-only

Without --yes it only says what it would do. DATABASE_URL is read the same way the API reads it
(Render's "External Database URL" works as is). Fix the passwords with SEED_PASSWORD / SEED_PIN.
"""

import asyncio
import os
import secrets
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

args = set(sys.argv[1:])
unknown = args - {"--yes", "--wipe-only"}
if unknown:
    sys.exit(f"Unknown option(s): {', '.join(sorted(unknown))}\n\n{__doc__}")

# Random credentials unless the caller chose them, set before the seed module reads them.
os.environ.setdefault("SEED_PASSWORD", secrets.token_urlsafe(9) + "7a")
if "SEED_PIN" not in os.environ:
    from app.modules.member_app.schemas import _check_pin

    while True:
        pin = f"{secrets.randbelow(10_000):04d}"
        try:
            _check_pin(pin)
            os.environ["SEED_PIN"] = pin
            break
        except ValueError:
            continue

from sqlalchemy import text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

import app.models  # noqa: E402,F401  (registers every table)
from app.core.config import settings  # noqa: E402
from app.core.db import Base, engine  # noqa: E402

url = make_url(settings.database_url)
target = f"{url.drivername.split('+')[0]} database '{url.database}' on {url.host or 'local file'}"


async def wipe() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
    await engine.dispose()


def main() -> None:
    action = "empty it" if "--wipe-only" in args else "empty it and add the demo gym"
    if "--yes" not in args:
        print(
            f"Would delete EVERYTHING in {target}, then {action}.\nRun again with --yes to do it."
        )
        return
    print(f"Deleting everything in {target} ...")
    asyncio.run(wipe())

    print("Recreating the tables ...")
    # Alembic runs in its own process: its async env can't start inside this event loop.
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, check=True)

    if "--wipe-only" in args:
        print("Done. The database is empty: open the app and sign up to start fresh.")
        return

    import seed  # scripts/seed.py: the demo gym

    asyncio.run(seed.main())
    print("\nDemo logins (fake data; delete with --wipe-only when you're done):")
    for email in [seed.OWNER_EMAIL, seed.TRAINER_EMAIL, *(t[0] for t in seed.TEAM)]:
        print(f"  {email}  /  {seed.DEMO_PASSWORD}")
    print(f"  Member app: phone {seed.MEMBER_PHONE}  /  PIN {seed.DEMO_PIN}  (open /m/login)")


if __name__ == "__main__":
    main()
