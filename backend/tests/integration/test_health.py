"""Health endpoint tests"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from app.main import app
    return TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_200(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["schema_version"] == "1.2"
        assert "app_version" in data

    def test_health_v1_returns_200(self, client):
        resp = client.get("/api/v1/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["schema_version"] == "1.2"

    def test_runtime_status(self, client):
        resp = client.get("/api/v1/runtime/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["state"] == "running"
        assert data["base_url"] == "http://127.0.0.1:8765"
        assert "pid" in data
        assert "instance_id" in data
