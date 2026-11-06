"""Install an already signed native release and its own static nginx locations."""
import argparse,base64,datetime,hashlib,json,os,shutil,subprocess,zipfile
from pathlib import Path

def main():
 p=argparse.ArgumentParser();p.add_argument('--release-dir',type=Path,required=True);args=p.parse_args()
 source=args.release_dir.resolve(strict=True)
 envelope=json.loads((source/'latest.json').read_text())
 release=json.loads(base64.b64decode(envelope['payload'],validate=True))
 archive=source/'client.zip';sha=hashlib.sha256(archive.read_bytes()).hexdigest()
 assert release['schema']==1 and release['kind']=='turtleclient-native'
 assert release['sha256']==sha and release['size']==archive.stat().st_size
 assert release['url']=='https://45.133.9.162/turtleclient/client/releases/'+sha+'/client.zip'
 assert envelope['signature'] and release['platform']=='windows-x86_64'
 with zipfile.ZipFile(archive) as zip:
  names=zip.namelist();assert len(names)<=256
  assert {'TurtleClient.exe','LICENSE','THIRD_PARTY_NOTICES.md','turtleclient-base.json'}<=set(names)
  for name in names:
   assert name in ['TurtleClient.exe','LICENSE','THIRD_PARTY_NOTICES.md','turtleclient-base.json'] or (name.startswith('licenses/') and name.endswith('.txt'))
   assert '..' not in name.split('/') and '\\' not in name and ':' not in name
  assert hashlib.sha256(zip.read('TurtleClient.exe')).hexdigest()==release['exe_sha256']
 root=Path('/var/lib/turtleclient/client');target=root/'releases'/sha;target.mkdir(parents=True,exist_ok=True)
 for folder in [root,root/'releases',target]:folder.chmod(0o755)
 artifact=target/'client.zip'
 if artifact.exists():assert hashlib.sha256(artifact.read_bytes()).hexdigest()==sha
 else:shutil.copyfile(archive,artifact);artifact.chmod(0o644)
 latest=root/'latest.json'
 if latest.exists():
  previous=json.loads(base64.b64decode(json.loads(latest.read_text())['payload']))
  assert release['sequence']>previous['sequence'],'Release sequence must increase'
 backup=Path('/var/backups/turtleclient')/('client-updates-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));backup.mkdir(parents=True)
 snippet=Path('/etc/nginx/snippets/turtleclient-client-updates.conf')
 include=Path('/etc/nginx/snippets/turtleclient.conf')
 for original in [latest,snippet,include]:
  if original.exists():shutil.copyfile(original,backup/original.name)
 old_snippet=snippet.read_bytes() if snippet.exists() else None;old_include=include.read_bytes()
 snippet.write_text('''location = /turtleclient/client/latest.json {
    alias /var/lib/turtleclient/client/latest.json;
    limit_except GET { deny all; }
    default_type application/json;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options nosniff always;
}
location ^~ /turtleclient/client/releases/ {
    alias /var/lib/turtleclient/client/releases/;
    limit_except GET { deny all; }
    autoindex off;
    add_header Cache-Control "public, max-age=31536000, immutable";
    add_header X-Content-Type-Options nosniff always;
}
''')
 line='include /etc/nginx/snippets/turtleclient-client-updates.conf;'
 if line not in include.read_text():include.write_text(include.read_text()+'\n'+line+'\n')
 try:
  subprocess.run(['nginx','-t'],check=True)
  subprocess.run(['systemctl','reload','nginx'],check=True)
 except Exception:
  include.write_bytes(old_include)
  if old_snippet is None:snippet.unlink(missing_ok=True)
  else:snippet.write_bytes(old_snippet)
  raise
 temp=root/'latest.json.pending';shutil.copyfile(source/'latest.json',temp);temp.chmod(0o644);os.replace(temp,latest)
 print('Published native client',release['version'],sha,'backup',backup)
if __name__=='__main__':main()
