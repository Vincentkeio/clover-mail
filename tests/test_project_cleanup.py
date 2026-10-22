import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cleanup', Path(__file__).resolve().parents[1] / 'scripts/cleanup-project.py')
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


def image(letter, tags=None, source=None):
    return {'Id': 'sha256:' + letter * 64, 'RepoTags': tags or [],
            'Config': {'Labels': {'org.opencontainers.image.source': source} if source else {}}}


class CleanupSafetyTests(unittest.TestCase):
    def test_legacy_clover_preview_detected_without_manifest(self):
        old = image('a', ['clover-panel:preview-20261022'], cleanup.SOURCE)
        self.assertEqual(cleanup.image_candidates([old], [], []), [old])

    def test_every_container_protects_its_image_even_unrelated_or_stopped(self):
        old = image('a', ['clover-panel:preview-base'], cleanup.SOURCE)
        for state in ['running', 'exited']:
            container = {'Image': old['Id'], 'State': {'Status': state}}
            self.assertEqual(cleanup.image_candidates([old], [container], []), [])

    def test_other_project_tag_on_same_clover_image_is_preserved(self):
        old = image('a', ['clover-panel:preview-base', 'other-project:rollback'], cleanup.SOURCE)
        self.assertEqual(cleanup.image_candidates([old], [], []), [])

    def test_upstream_label_or_dangling_alone_is_insufficient(self):
        old = image('a', [], 'https://github.com/caddyserver/caddy-docker')
        self.assertEqual(cleanup.image_candidates([old, image('b')], [], []), [])

    def test_exact_preupdate_container_image_record_allows_upstream_cleanup(self):
        old = image('a')
        records = [{'id': old['Id'], 'ref': 'caddy:2'}]
        self.assertEqual(cleanup.image_candidates([old], [], records), [old])
        old['RepoTags'] = ['other-project:caddy']
        self.assertEqual(cleanup.image_candidates([old], [], records), [])

    def test_current_and_foreign_project_containers_never_enter_capture(self):
        def container(path, role):
            return {'Config': {'Labels': {'com.docker.compose.project.working_dir': path,
                                         'com.docker.compose.service': role}}}
        own = container('/opt/clover', 'panel')
        other = container('/opt/other', 'panel')
        self.assertEqual(cleanup.project_containers([own, other], '/opt/clover'), [own])
        with self.assertRaises(RuntimeError):
            cleanup.project_containers([other], '/opt/clover')

    def test_cache_cleanup_is_id_scoped_private_immutable_and_clover_specific(self):
        valid = {'ID': 'a' * 25, 'Description': '[4/5] COPY scripts/certificates.py /app/certificates.py',
                 'Shared': False, 'Mutable': False, 'Reclaimable': True}
        self.assertEqual(list(cleanup.cache_candidates([valid])), [valid['ID']])
        for mutation in [{'Shared': True}, {'Mutable': True}, {'Reclaimable': False},
                         {'Description': 'COPY . .'}, {'ID': ''}]:
            self.assertEqual(list(cleanup.cache_candidates([{**valid, **mutation}])), [])

    def test_deletion_rechecks_tag_and_new_container_and_never_forces(self):
        old = image('a', ['clover-panel:preview-base'], cleanup.SOURCE)
        changed = image('b', old['RepoTags'], cleanup.SOURCE)
        import json
        with patch.object(cleanup, 'docker', return_value=json.dumps([changed])) as run:
            self.assertFalse(cleanup.remove_image(old))
            self.assertEqual(run.call_count, 1)
        with patch.object(cleanup, 'docker', return_value=json.dumps([old])) as run, \
                patch.object(cleanup, 'containers', return_value=[{'Image': old['Id']}]):
            self.assertFalse(cleanup.remove_image(old))
            self.assertEqual(run.call_count, 1)
        with patch.object(cleanup, 'docker', return_value=json.dumps([old])) as run, \
                patch.object(cleanup, 'containers', return_value=[]):
            self.assertTrue(cleanup.remove_image(old))
            self.assertEqual(run.call_args.args, ('image', 'rm', '--no-prune', 'clover-panel:preview-base'))

    def test_state_is_atomic_and_bound_to_the_installation(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            state = {'project': '/opt/clover', 'images': [], 'pending': True}
            cleanup.write_state(project, state)
            self.assertTrue(cleanup.read_state(project, '/opt/clover')['pending'])
            with self.assertRaises(RuntimeError):
                cleanup.read_state(project, '/opt/other')


if __name__ == '__main__':
    unittest.main()
