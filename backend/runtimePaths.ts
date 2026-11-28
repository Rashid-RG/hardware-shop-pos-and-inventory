import fs from 'node:fs';
import path from 'node:path';

export function resolveRuntimePaths(project: string, override?: string) {
  const projectRoot = path.resolve(project);
  if (override === undefined) {
    return { external: false, root: projectRoot, config: path.join(projectRoot, '.env.local'), uploads: path.join(projectRoot, 'uploads'), backups: path.join(projectRoot, 'backups') };
  }
  // An explicit override must already exist and cannot silently fall back to release-local files.
  if (!override.trim() || !path.isAbsolute(override)) throw new Error('ARS_RUNTIME_ROOT must be an existing absolute directory.');
  const root = path.resolve(override);
  if (root === projectRoot || root.startsWith(projectRoot + path.sep)) throw new Error('External runtime must be outside the application release.');
  function verify(target: string, directory: boolean) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('Invalid external runtime path.');
    if (fs.realpathSync(target) !== target && (process.platform !== 'win32' || fs.realpathSync(target).toLowerCase() !== target.toLowerCase())) throw new Error('External runtime path resolves through a link.');
    return target;
  }
  verify(root, true);
  return { external: true, root, config: verify(path.join(root, '.env.local'), false), uploads: verify(path.join(root, 'uploads'), true), backups: verify(path.join(root, 'backups'), true) };
}
