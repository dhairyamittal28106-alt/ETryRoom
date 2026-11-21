"""API regression tests without a webcam, GPU, or model dependencies."""
import base64
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


class MirrorApiTests(unittest.TestCase):
    def setUp(self):
        dependencies = {name: MagicMock() for name in (
            'cv2', 'numpy', 'core.detector', 'core.stylist',
            'core.engine_3d', 'core.pose_mapper',
        )}
        spec = importlib.util.spec_from_file_location('mirror_test_app', ROOT / 'app.py')
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, dependencies):
            spec.loader.exec_module(self.module)
        self.client = TestClient(self.module.app)

    def tearDown(self):
        self.client.close()

    def test_home_and_assets_resolve_outside_project_directory(self):
        self.assertEqual(self.client.get('/').status_code, 200)
        self.assertEqual(self.client.get('/static/script.js').status_code, 200)

    def test_missing_camera_returns_actionable_error(self):
        self.assertFalse(self.client.get('/status').json()['camera_ready'])
        response = self.client.get('/video_feed')
        self.assertEqual(response.status_code, 503)
        self.assertIn('camera', response.json()['detail'])

    def test_shirts_alias_initializes_once(self):
        for name in ('Shirts', 'clothes'):
            response = self.client.get('/change_category', params={'name': name})
            self.assertEqual(response.json()['category'], 'clothes')
        self.module.Engine3D.assert_called_once()

    def test_unimplemented_category_is_rejected_without_changing_mode(self):
        self.client.get('/change_category?name=camera')
        self.assertEqual(self.client.get('/change_category?name=hair').status_code, 400)
        self.assertEqual(self.module.current_category, 'camera')
        self.module.Engine3D.assert_not_called()

    def test_renderer_failure_preserves_camera_mode(self):
        self.client.get('/change_category?name=camera')
        self.module.Engine3D.side_effect = RuntimeError('missing model')
        self.assertEqual(self.client.get('/change_category?name=clothes').status_code, 503)
        self.assertEqual(self.module.current_category, 'camera')
        self.assertFalse(self.client.get('/status').json()['engine_ready'])

    def test_visibility_toggle_round_trip(self):
        self.assertFalse(self.client.get('/toggle_mesh').json()['show_mesh'])
        self.assertTrue(self.client.get('/toggle_mesh').json()['show_mesh'])

    def test_upload_initializes_renderer_and_decodes_data_uri(self):
        image = b'image bytes supplied to mocked decoder'
        response = self.client.post('/upload_texture', json={
            'image_data': 'data:image/png;base64,' + base64.b64encode(image).decode()
        })
        self.assertEqual(response.status_code, 200)
        self.module.engine3d.update_texture_from_bytes.assert_called_once_with(image)

    def test_invalid_base64_does_not_initialize_renderer(self):
        response = self.client.post('/upload_texture', json={'image_data': 'not base64!'})
        self.assertEqual(response.status_code, 400)
        self.module.Engine3D.assert_not_called()

    def test_invalid_image_is_not_reported_as_success(self):
        self.module.Engine3D.return_value.update_texture_from_bytes.side_effect = ValueError('Invalid image')
        response = self.client.post('/upload_texture', json={'image_data': 'dGV4dA=='})
        self.assertEqual(response.status_code, 400)

    def test_empty_and_oversized_uploads_are_rejected(self):
        for data in ('', 'a' * 7_000_001):
            self.assertEqual(self.client.post('/upload_texture', json={'image_data': data}).status_code, 422)


if __name__ == '__main__':
    unittest.main()
