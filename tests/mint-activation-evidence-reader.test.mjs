import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('../scripts/mint/',import.meta.url));
test('Mint evidence reader ignores access time but detects changed content metadata',{skip:process.platform==='win32'},()=>{
 const code=[
 'import importlib.util, os, tempfile, pathlib, sys',
 'sys.path.insert(0,sys.argv[1])',
 'spec=importlib.util.spec_from_file_location("proposal",pathlib.Path(sys.argv[1])/"prepare-runtime-activation.py")',
 'm=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
 'with tempfile.TemporaryDirectory() as root:',
 ' p=pathlib.Path(root)/"evidence.json"; p.write_bytes(b"{}")',
 ' s=p.stat(); os.utime(p,ns=(1,s.st_mtime_ns))',
 ' assert m.read(p)==b"{}"',
 ' a=p.stat(); os.utime(p,ns=(a.st_atime_ns,a.st_mtime_ns+1000000000))',
 ' assert m.identity(a)!=m.identity(p.stat())',
 ' link=pathlib.Path(root)/"link"; link.symlink_to(p)',
 ' try: m.read(link)',
 ' except ValueError: pass',
 ' else: raise AssertionError("symlink accepted")',
 ].join('\n');
 execFileSync('python3',['-c',code,dir],{timeout:15000});
});
