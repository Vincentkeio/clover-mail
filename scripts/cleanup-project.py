#!/usr/bin/env python3
"""Conservative migration of Clover-owned images; never prune host-wide resources."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

SOURCE = 'https://github.com/Vincentkeio/clover-mail'
IMAGE_ID = re.compile(r'^sha256:[a-f0-9]{64}$')
CACHE_ID = re.compile(r'^[a-z0-9]{20,64}$')
STATE_NAME = '.clover-cleanup-state.json'


def docker(*args, optional=False):
    result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=120)
    if result.returncode:
        if optional:
            return ''
        # Docker errors may include environment/command details. Log only the action.
        raise RuntimeError('Docker 操作失败：' + ' '.join(args[:2]))
    return result.stdout.strip()


def objects(kind, ids):
    return json.loads(docker(kind, 'inspect', *ids)) if ids else []


def containers():
    return objects('container', docker('ps', '-aq').split())


def tags(image):
    return set(image.get('RepoTags') or []) - {'<none>:<none>'}


def normalize_ref(ref):
    return ref if '@' in ref or ':' in ref.rsplit('/', 1)[-1] else ref + ':latest'


def project_containers(all_containers, host_project):
    result = []
    for container in all_containers:
        labels = container.get('Config', {}).get('Labels') or {}
        if labels.get('com.docker.compose.project.working_dir') == host_project \
                and labels.get('com.docker.compose.service') in {'panel', 'mail', 'roundcube', 'caddy', 'certificate-helper'}:
            result.append(container)
    if not any((c.get('Config', {}).get('Labels') or {}).get('com.docker.compose.service') == 'panel' for c in result):
        raise RuntimeError('无法核验当前 Clover 项目容器；未执行清理。')
    return result


def image_records(project):
    return [{'id': c['Image'], 'ref': normalize_ref(c['Config']['Image'])} for c in project]


def merge_records(*groups):
    return [dict(id=image_id, ref=ref) for image_id, ref in sorted({
        (r.get('id', ''), r.get('ref', '')) for group in groups for r in group
        if IMAGE_ID.fullmatch(r.get('id', '')) and r.get('ref') and not r['ref'].startswith('-')
    })]


def clover_tag(tag):
    repo, _, value = tag.rpartition(':')
    if repo == 'ghcr.io/vincentkeio/clover-panel':
        return bool(re.fullmatch(r'[A-Za-z0-9_.-]+', value))
    return repo in {'clover-panel', 'clover-certificate-helper'} and (
        value == 'latest' or value == 'preview-base' or value.startswith('preview-'))


def image_candidates(images, all_containers, records):
    """Every container, including stopped/unrelated containers, protects its image."""
    used = {c['Image'] for c in all_containers}
    recorded = {}
    for record in records:
        recorded.setdefault(record['id'], set()).add(normalize_ref(record['ref']))
    result = []
    for image in images:
        image_id = image['Id']
        if image_id in used or not IMAGE_ID.fullmatch(image_id):
            continue
        labels = image.get('Config', {}).get('Labels') or {}
        first_party = labels.get('org.opencontainers.image.source', '').rstrip('/') == SOURCE
        known_refs = recorded.get(image_id, set())
        # Upstream Caddy/Roundcube labels alone never establish project ownership.
        if not first_party and not known_refs:
            continue
        image_tags = tags(image)
        if any(tag not in known_refs and not (first_party and clover_tag(tag)) for tag in image_tags):
            continue
        result.append(image)
    return result


def cache_candidates(records):
    # Do not walk parents: base/runtime cache can be shared with unrelated builds.
    for record in records:
        description = record.get('Description', '')
        owned = any(marker in description for marker in (
            'COPY scripts/host-caddy.py /app/host-caddy.py',
            'COPY scripts/certificates.py /app/certificates.py',
            'https://github.com/Vincentkeio/clover-mail.git',
        ))
        if owned and CACHE_ID.fullmatch(record.get('ID', '')) and record.get('Reclaimable') is True \
                and record.get('Mutable') is False and record.get('Shared') is False:
            yield record['ID']


def read_state(project, host_project):
    path = project / 'backups' / STATE_NAME
    if path.is_symlink():
        raise RuntimeError('清理状态文件是符号链接，已停止。')
    if not path.exists():
        return {'project': host_project, 'images': [], 'pending': False}
    state = json.loads(path.read_text(encoding='utf-8'))
    if state.get('project') != host_project:
        raise RuntimeError('清理归属记录与当前项目路径不一致，已停止。')
    state['images'] = merge_records(state.get('images', []))
    return state


def write_state(project, state):
    directory = project / 'backups'
    directory.mkdir(mode=0o700, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.clover-cleanup-', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as destination:
            json.dump(state, destination, ensure_ascii=False)
        os.replace(name, directory / STATE_NAME)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def old_manifest(project):
    path = project / '.clover-managed-images'
    if not path.is_file() or path.is_symlink():
        return []
    records = []
    for line in path.read_text(encoding='utf-8').splitlines():
        parts = line.split('\t')
        if len(parts) == 2:
            records.append({'id': parts[0], 'ref': parts[1]})
    return merge_records(records)


def remove_image(image):
    image_id = image['Id']
    # Recheck references and container use immediately before each removal.
    for ref in sorted(tags(image)) or [image_id]:
        current = json.loads(docker('image', 'inspect', ref))
        if current[0]['Id'] != image_id or tags(current[0]) != tags(image) or image_id in {c['Image'] for c in containers()}:
            return False
        docker('image', 'rm', '--no-prune', ref)  # no --force, even when a container appears concurrently
        image['RepoTags'] = sorted(tags(image) - {ref})
    return True


def clean_snapshots():
    script = r'''
const fs = require('node:fs');
const dir = '/app/data';
for (const name of fs.readdirSync(dir)) {
  if (!/^(clover-before-update-\d{8}T\d{6}Z|before-ui-\d{8})\.db$/.test(name)) continue;
  const path = dir + '/' + name;
  if (fs.lstatSync(path).isFile()) fs.unlinkSync(path);
}
'''
    docker('exec', 'clover-panel', 'node', '-e', script)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['capture', 'pending', 'finish', 'plan'])
    parser.add_argument('--project', required=True, type=Path)
    parser.add_argument('--host-project', required=True)
    args = parser.parse_args()
    project = args.project.resolve()
    all_containers = containers()
    active = project_containers(all_containers, args.host_project)
    state = read_state(project, args.host_project)
    if args.action == 'pending':
        return 0 if state.get('pending') else 2
    if args.action == 'capture':
        state['images'] = merge_records(state['images'], old_manifest(project), image_records(active))
        state['pending'] = True
        write_state(project, state)
        print('[cleanup] 已记录更新前的 Clover 镜像归属。')
        return 0
    if not state.get('pending'):
        print('[cleanup] 无待完成的 Clover 更新，跳过清理。')
        return 0
    for attempt in range(46):
        if all(c.get('State', {}).get('Status') == 'running'
               and c.get('State', {}).get('Health', {}).get('Status', 'healthy') == 'healthy' for c in active):
            break
        if attempt == 45:
            raise RuntimeError('Clover 服务未全部就绪，保留旧镜像与备份。')
        time.sleep(2)
        all_containers = containers()
        active = project_containers(all_containers, args.host_project)
    image_ids = docker('image', 'ls', '-aq', '--no-trunc').split()
    images = objects('image', sorted(set(image_ids)))
    records = merge_records(state['images'], old_manifest(project))
    candidates = image_candidates(images, all_containers, records)
    if args.action == 'plan':
        print(json.dumps({'images': [i['Id'] for i in candidates]}, ensure_ascii=False))
        return 0
    failures = []
    removed = 0
    for image in candidates:
        try:
            if remove_image(image):
                removed += 1
                print('[cleanup] 已删除无容器引用的 Clover 旧镜像：' + image['Id'][:19])
            else:
                failures.append(image['Id'])
        except (RuntimeError, subprocess.TimeoutExpired):
            failures.append(image['Id'])
            print('[cleanup] 镜像清理未完成，保留归属记录以便重试。')
    output = docker('buildx', 'du', '--builder', 'default', '--format=json', optional=True)
    try:
        cache = [json.loads(line) for line in output.splitlines() if line.strip()]
        for cache_id in cache_candidates(cache):
            docker('buildx', 'prune', '--builder', 'default', '--force',
                   '--filter', 'id=' + cache_id, '--filter', 'private=true', '--filter', 'immutable=true')
            print('[cleanup] 已删除能确认由 Clover 产生的独立缓存：' + cache_id)
    except (ValueError, RuntimeError, subprocess.TimeoutExpired):
        print('[cleanup] 当前 Docker 无法定向清理历史缓存；共享缓存保持原样。')
    # The shell entry point runs a fresh complete backup before entering finish.
    clean_snapshots()
    remaining = set(docker('image', 'ls', '-aq', '--no-trunc').split())
    state['images'] = merge_records([r for r in records if r['id'] in remaining],
                                   image_records(project_containers(containers(), args.host_project)))
    state['pending'] = bool(failures)
    state['last_cleanup'] = {'removed_images': removed, 'failed_images': failures}
    write_state(project, state)
    print('[cleanup] Clover 更新后清理完成；数据卷、共享缓存及归属不明的镜像均保留。')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, KeyError, OSError, subprocess.TimeoutExpired) as error:
        print('[cleanup] ' + str(error), flush=True)
        raise SystemExit(1)
