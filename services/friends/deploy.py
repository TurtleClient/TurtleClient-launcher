"""Run on the VPS with an explicitly supplied, prebuilt Linux executable.
Only installs the friends service and its own nginx locations. No Ocean restart.
"""
import argparse
import datetime
import hashlib
from pathlib import Path
import shutil
import subprocess

def run(*args):
    subprocess.run(args, check=True)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--binary',type=Path,required=True)
    parser.add_argument('--sha256',required=True)
    args=parser.parse_args()
    binary=args.binary.resolve(strict=True)
    digest=hashlib.sha256(binary.read_bytes()).hexdigest()
    if digest!=args.sha256:raise SystemExit('Binary checksum mismatch')
    backup=Path('/var/backups/turtleclient')/('friends-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(parents=True,exist_ok=False)
    release=Path('/opt/turtleclient/friends/releases')/digest[:16]
    release.mkdir(parents=True,exist_ok=True)
    target=release/'turtleclient-friends'
    shutil.copyfile(binary,target);target.chmod(0o755)
    data=Path('/var/lib/turtleclient/friends');data.mkdir(parents=True,exist_ok=True)
    run('chown','turtleclient:turtleclient',str(data));data.chmod(0o700)
    unit=Path('/etc/systemd/system/turtleclient-friends.service')
    snippet=Path('/etc/nginx/snippets/turtleclient-friends.conf')
    zone=Path('/etc/nginx/conf.d/turtleclient-friends.conf')
    include=Path('/etc/nginx/snippets/turtleclient.conf')
    paths=[unit,snippet,zone,include]
    originals={p:p.read_bytes() if p.exists() else None for p in paths}
    for p,contents in originals.items():
        if contents is not None:(backup/p.name.replace('.conf','-'+('locations' if p==snippet else 'config')+'.conf')).write_bytes(contents)
    unit.write_text(f'''[Unit]
Description=TurtleClient friends
After=network-online.target
[Service]
User=turtleclient
Group=turtleclient
WorkingDirectory={data}
ExecStart={target}
Restart=on-failure
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
ReadWritePaths={data}
MemoryMax=256M
TasksMax=32
[Install]
WantedBy=multi-user.target
''')
    zone.write_text('limit_req_zone $binary_remote_addr zone=turtle_friends:1m rate=5r/s;\nlimit_req_zone $binary_remote_addr zone=turtle_friends_login:1m rate=6r/m;\n')
    snippet.write_text('''location = /turtleclient/social/session {
    limit_except POST { deny all; }
    client_max_body_size 1k;
    limit_req zone=turtle_friends_login burst=3 nodelay;
    limit_req_status 429;
    proxy_pass http://127.0.0.1:3001/session;
    proxy_connect_timeout 3s;
    proxy_read_timeout 20s;
    add_header Cache-Control "no-store" always;
}
location ^~ /turtleclient/social/ {
    limit_except GET POST DELETE { deny all; }
    client_max_body_size 1k;
    limit_req zone=turtle_friends burst=20 nodelay;
    limit_req_status 429;
    proxy_pass http://127.0.0.1:3001/;
    proxy_connect_timeout 3s;
    proxy_read_timeout 5s;
    add_header X-Content-Type-Options nosniff always;
    add_header Cache-Control "no-store" always;
}
''')
    line='include /etc/nginx/snippets/turtleclient-friends.conf;'
    content=include.read_text()
    if line not in content:include.write_text(content+'\n'+line+'\n')
    try:
        run('nginx','-t')
        run('systemctl','daemon-reload')
        run('systemctl','enable','--now','turtleclient-friends.service')
        run('systemctl','restart','turtleclient-friends.service')
        run('systemctl','is-active','--quiet','turtleclient-friends.service')
        run('systemctl','reload','nginx')
    except Exception:
        for path,contents in originals.items():
            if contents is None:path.unlink(missing_ok=True)
            else:path.write_bytes(contents)
        run('systemctl','daemon-reload')
        if originals[unit] is None:subprocess.run(['systemctl','disable','--now','turtleclient-friends.service'],check=False)
        else:subprocess.run(['systemctl','restart','turtleclient-friends.service'],check=False)
        raise
    print('Installed friends service; backup:',backup)

if __name__=='__main__':main()
