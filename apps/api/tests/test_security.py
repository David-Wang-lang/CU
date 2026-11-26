from uuid import uuid4

from app.core.security import create_access_token, decode_token, hash_password, verify_password


def test_password_roundtrip() -> None:
    hashed = hash_password("admin123!")
    assert verify_password("admin123!", hashed)
    assert not verify_password("wrong", hashed)


def test_access_token_claims() -> None:
    user_id = uuid4()
    org_id = uuid4()
    token = create_access_token(user_id, org_id, "admin")
    payload = decode_token(token)
    assert payload["sub"] == str(user_id)
    assert payload["org"] == str(org_id)
    assert payload["type"] == "access"
