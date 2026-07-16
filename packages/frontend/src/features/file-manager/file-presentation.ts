const fileIconByExtension: Record<string, string> = {
  'jpg': 'fas fa-file-image', 'jpeg': 'fas fa-file-image', 'png': 'fas fa-file-image', 'gif': 'fas fa-file-image', 'bmp': 'fas fa-file-image', 'svg': 'fas fa-file-image', 'webp': 'fas fa-file-image', 'ico': 'fas fa-file-image', 'tiff': 'fas fa-file-image',
  'mp4': 'fas fa-file-video', 'mkv': 'fas fa-file-video', 'avi': 'fas fa-file-video', 'mov': 'fas fa-file-video', 'wmv': 'fas fa-file-video', 'flv': 'fas fa-file-video', 'webm': 'fas fa-file-video',
  'mp3': 'fas fa-file-audio', 'wav': 'fas fa-file-audio', 'ogg': 'fas fa-file-audio', 'flac': 'fas fa-file-audio', 'aac': 'fas fa-file-audio', 'm4a': 'fas fa-file-audio',
  'doc': 'fas fa-file-word', 'docx': 'fas fa-file-word', 'xls': 'fas fa-file-excel', 'xlsx': 'fas fa-file-excel', 'ppt': 'fas fa-file-powerpoint', 'pptx': 'fas fa-file-powerpoint', 'pdf': 'fas fa-file-pdf', 'odt': 'fas fa-file-alt', 'ods': 'fas fa-file-alt', 'odp': 'fas fa-file-alt', 'rtf': 'fas fa-file-alt', 'csv': 'fas fa-file-csv', 'tsv': 'fas fa-file-csv',
  'zip': 'fas fa-file-archive', 'rar': 'fas fa-file-archive', 'tar': 'fas fa-file-archive', 'gz': 'fas fa-file-archive', '7z': 'fas fa-file-archive', 'bz2': 'fas fa-file-archive', 'xz': 'fas fa-file-archive', 'iso': 'fas fa-compact-disc',
  'js': 'fab fa-js-square', 'mjs': 'fab fa-js-square', 'cjs': 'fab fa-js-square', 'jsx': 'fab fa-react', 'ts': 'fas fa-file-code', 'tsx': 'fab fa-react', 'vue': 'fab fa-vuejs', 'svelte': 'fas fa-file-code',
  'py': 'fab fa-python', 'pyc': 'fab fa-python', 'pyd': 'fab fa-python', 'pyw': 'fab fa-python', 'ipynb': 'fab fa-python', 'java': 'fab fa-java', 'jar': 'fab fa-java', 'class': 'fab fa-java', 'kt': 'fas fa-file-code', 'kts': 'fas fa-file-code', 'cs': 'fas fa-file-code', 'fs': 'fas fa-file-code', 'go': 'fas fa-file-code', 'rs': 'fas fa-file-code', 'c': 'fas fa-file-code', 'h': 'fas fa-file-code', 'cpp': 'fas fa-file-code', 'hpp': 'fas fa-file-code', 'cxx': 'fas fa-file-code', 'hxx': 'fas fa-file-code', 'rb': 'fas fa-gem', 'erb': 'fas fa-gem', 'php': 'fab fa-php', 'swift': 'fab fa-swift', 'scala': 'fas fa-file-code', 'perl': 'fas fa-file-code', 'pl': 'fas fa-file-code', 'lua': 'fas fa-file-code', 'dart': 'fas fa-file-code', 'r': 'fas fa-file-code',
  'html': 'fab fa-html5', 'htm': 'fab fa-html5', 'xhtml': 'fab fa-html5', 'css': 'fab fa-css3-alt', 'scss': 'fab fa-sass', 'sass': 'fab fa-sass', 'less': 'fab fa-less', 'styl': 'fas fa-file-code', 'json': 'fas fa-file-code', 'webmanifest': 'fas fa-file-code', 'jsonc': 'fas fa-file-code', 'xml': 'fas fa-file-code', 'xsl': 'fas fa-file-code', 'xsd': 'fas fa-file-code', 'yml': 'fas fa-cog', 'yaml': 'fas fa-cog', 'ini': 'fas fa-cog', 'conf': 'fas fa-cog', 'cfg': 'fas fa-cog', 'config': 'fas fa-cog', 'toml': 'fas fa-cog', 'md': 'fab fa-markdown', 'markdown': 'fab fa-markdown', 'sql': 'fas fa-database', 'ddl': 'fas fa-database', 'db': 'fas fa-database', 'sqlite': 'fas fa-database', 'mdb': 'fas fa-database', 'lock': 'fas fa-lock',
  'gitignore': 'fab fa-git-alt', 'gitkeep': 'fab fa-git-alt', 'dockerignore': 'fab fa-docker', 'npmrc': 'fab fa-npm', 'yarnrc': 'fab fa-yarn', 'pnpmfile.js': 'fas fa-cogs', 'babelrc': 'fas fa-cogs', 'eslintrc': 'fas fa-cogs', 'prettierrc': 'fas fa-cogs', 'stylelintrc': 'fas fa-cogs', 'browserslistrc': 'fas fa-cogs', 'editorconfig': 'fas fa-cog', 'tsconfig.json': 'fas fa-cogs', 'jsconfig.json': 'fas fa-cogs', 'webpack.config.js': 'fas fa-cogs', 'vite.config.js': 'fas fa-cogs', 'vite.config.ts': 'fas fa-cogs', 'rollup.config.js': 'fas fa-cogs', 'postcss.config.js': 'fas fa-cogs', 'jest.config.js': 'fas fa-cogs', 'cypress.json': 'fas fa-cogs', 'playwright.config.ts': 'fas fa-cogs',
  'txt': 'fas fa-file-alt', 'text': 'fas fa-file-alt', 'log': 'fas fa-file-alt', 'out': 'fas fa-file-alt', 'err': 'fas fa-file-alt', 'key': 'fas fa-key', 'pem': 'fas fa-key', 'pub': 'fas fa-key', 'asc': 'fas fa-key', 'crt': 'fas fa-certificate', 'cer': 'fas fa-certificate', 'csr': 'fas fa-certificate', 'pfx': 'fas fa-certificate', 'p12': 'fas fa-certificate',
  'exe': 'fas fa-cogs', 'msi': 'fas fa-cogs', 'app': 'fas fa-cogs', 'com': 'fas fa-cogs', 'sh': 'fas fa-terminal', 'bash': 'fas fa-terminal', 'zsh': 'fas fa-terminal', 'fish': 'fas fa-terminal', 'csh': 'fas fa-terminal', 'ksh': 'fas fa-terminal', 'bat': 'fas fa-terminal', 'cmd': 'fas fa-terminal', 'ps1': 'fas fa-terminal', 'psm1': 'fas fa-terminal', 'vb': 'fas fa-file-code', 'vbs': 'fas fa-file-code', 'deb': 'fas fa-archive', 'rpm': 'fas fa-archive', 'pkg': 'fas fa-archive', 'dmg': 'fas fa-compact-disc', 'img': 'fas fa-compact-disc',
  'ttf': 'fas fa-font', 'otf': 'fas fa-font', 'woff': 'fas fa-font', 'woff2': 'fas fa-font', 'eot': 'fas fa-font', 'bashrc': 'fas fa-cog', 'zshrc': 'fas fa-cog', 'profile': 'fas fa-cog', 'bash_profile': 'fas fa-cog', 'vimrc': 'fas fa-cog', 'screenrc': 'fas fa-cog', 'tmux.conf': 'fas fa-cog', 'gitconfig': 'fab fa-git-alt', 'npmignore': 'fab fa-npm', 'htaccess': 'fas fa-cog', 'htpasswd': 'fas fa-lock',
};

export const formatFileSize = (size: number): string => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export const formatUnixFileMode = (mode: number): string => {
  const permission = mode & 0o777;
  return [
    permission & 0o400 ? 'r' : '-', permission & 0o200 ? 'w' : '-', permission & 0o100 ? 'x' : '-',
    permission & 0o040 ? 'r' : '-', permission & 0o020 ? 'w' : '-', permission & 0o010 ? 'x' : '-',
    permission & 0o004 ? 'r' : '-', permission & 0o002 ? 'w' : '-', permission & 0o001 ? 'x' : '-',
  ].join('');
};

export const resolveFileIconClass = (filename: string): string => {
  const normalizedFilename = filename.toLowerCase();
  const lastDotIndex = normalizedFilename.lastIndexOf('.');
  const extension = lastDotIndex > 0 && lastDotIndex < normalizedFilename.length - 1
    ? normalizedFilename.substring(lastDotIndex + 1)
    : lastDotIndex === 0 && normalizedFilename.length > 1
      ? normalizedFilename.substring(1)
      : '';

  if (normalizedFilename === 'makefile') return 'fas fa-cogs';
  if (normalizedFilename === 'dockerfile' || normalizedFilename.endsWith('docker-compose.yml') || normalizedFilename.endsWith('docker-compose.yaml')) return 'fab fa-docker';
  if (normalizedFilename === 'package.json' || normalizedFilename === 'package-lock.json') return 'fab fa-npm';
  if (normalizedFilename === 'yarn.lock') return 'fab fa-yarn';
  if (normalizedFilename === 'composer.json' || normalizedFilename === 'composer.lock') return 'fab fa-php';
  if (normalizedFilename === 'gemfile' || normalizedFilename === 'gemfile.lock') return 'fas fa-gem';
  if (normalizedFilename.startsWith('.env')) return 'fas fa-shield-alt';
  if (['.git', '.gitignore', '.gitattributes', '.gitmodules'].includes(normalizedFilename)) return 'fab fa-git-alt';
  if (normalizedFilename === 'readme' || normalizedFilename.startsWith('readme.')) return 'fas fa-book-reader';
  if (normalizedFilename === 'license' || normalizedFilename.startsWith('license.')) return 'fas fa-balance-scale';
  if (normalizedFilename === 'contributing' || normalizedFilename.startsWith('contributing.')) return 'fas fa-users-cog';
  if (normalizedFilename === 'code_of_conduct' || normalizedFilename.startsWith('code_of_conduct.')) return 'fas fa-gavel';
  if (normalizedFilename === 'changelog' || normalizedFilename.startsWith('changelog.')) return 'fas fa-list-alt';
  if (normalizedFilename === 'favicon.ico') return 'fas fa-icons';

  return fileIconByExtension[extension] ?? 'far fa-file';
};
