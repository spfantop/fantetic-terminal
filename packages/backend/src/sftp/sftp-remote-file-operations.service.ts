import * as pathModule from 'path';
import { SFTPWrapper, Stats } from 'ssh2';
import { createLogger } from '../logging/logger';

const logger = createLogger('SftpRemoteFileOperations');

interface SftpDirEntry {
    filename: string;
    longname: string;
    attrs: Stats;
}

/**
 * SFTP remote filesystem primitives shared by copy, move and upload flows.
 * Session lookup and WebSocket messages intentionally remain in SftpService.
 */
export class SftpRemoteFileOperations {
    async copyFile(sftp: SFTPWrapper, sourcePath: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const readStream = sftp.createReadStream(sourcePath);
            const writeStream = sftp.createWriteStream(destPath);
            let errorOccurred = false;

            const onError = (err: Error) => {
                if (errorOccurred) return;
                errorOccurred = true;
                readStream.destroy();
                writeStream.destroy();
                logger.error('复制远端文件失败', { sourcePath, destPath, error: err });
                reject(new Error(`复制文件失败: ${err.message}`));
            };

            readStream.on('error', onError);
            writeStream.on('error', onError);

            writeStream.on('close', () => {
                if (!errorOccurred) {
                    resolve();
                }
            });

            readStream.pipe(writeStream);
        });
    }

    async copyDirectoryRecursively(sftp: SFTPWrapper, sourcePath: string, destPath: string): Promise<void> {
        try {
            await this.ensureDirectoryExists(sftp, destPath);
            const items = await this.listDirectory(sftp, sourcePath);

            for (const item of items) {
                const currentSourcePath = pathModule.join(sourcePath, item.filename).replace(/\\/g, '/');
                const currentDestPath = pathModule.join(destPath, item.filename).replace(/\\/g, '/');

                if (item.attrs.isDirectory()) {
                    await this.copyDirectoryRecursively(sftp, currentSourcePath, currentDestPath);
                } else if (item.attrs.isFile()) {
                    await this.copyFile(sftp, currentSourcePath, currentDestPath);
                } else {
                    logger.warn('跳过不支持的远端文件类型', { path: currentSourcePath });
                }
            }
        } catch (error: any) {
            logger.error('递归复制远端目录失败', { sourcePath, destPath, error });
            throw new Error(`递归复制目录失败: ${error.message}`);
        }
    }

    readStats(sftp: SFTPWrapper, path: string): Promise<Stats> {
        return new Promise((resolve, reject) => {
            sftp.lstat(path, (err, stats) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(stats);
                }
            });
        });
    }

    async ensureDirectoryExists(sftp: SFTPWrapper, dirPath: string): Promise<void> {
        const normalizedPath = dirPath.replace(/\/$/, '');
        if (!normalizedPath || normalizedPath === '/') {
            return;
        }

        try {
            await this.readStats(sftp, normalizedPath);
            return;
        } catch (statError: any) {
            if (statError.code === 'ENOENT' || (statError.message && statError.message.includes('No such file'))) {
                try {
                    await new Promise<void>((resolveMkdir, rejectMkdir) => {
                        // ssh2 types do not declare the recursive extension supported by some SFTP servers.
                        // @ts-ignore
                        sftp.mkdir(normalizedPath, { recursive: true }, (mkdirErr) => {
                            if (mkdirErr) {
                                logger.warn('远端递归创建目录失败，降级为逐层创建', { path: normalizedPath, error: mkdirErr });
                                rejectMkdir(mkdirErr);
                            } else {
                                logger.info('远端目录已递归创建', { path: normalizedPath });
                                resolveMkdir();
                            }
                        });
                    });
                    return;
                } catch (recursiveMkdirError) {
                    const parentDir = pathModule.dirname(normalizedPath).replace(/\\/g, '/');
                    if (parentDir && parentDir !== '/' && parentDir !== '.') {
                        await this.ensureDirectoryExists(sftp, parentDir);
                    }

                    try {
                        await new Promise<void>((resolveMkdir, rejectMkdir) => {
                            sftp.mkdir(normalizedPath, (mkdirErr) => {
                                if (mkdirErr) {
                                    rejectMkdir(new Error(`创建目录失败 ${normalizedPath}: ${mkdirErr.message}`));
                                } else {
                                    logger.info('远端目录已逐层创建', { path: normalizedPath });
                                    resolveMkdir();
                                }
                            });
                        });
                    } catch (iterativeMkdirError: any) {
                        logger.error('远端逐层创建目录失败', { path: normalizedPath, error: iterativeMkdirError });
                        try {
                            const finalStats = await this.readStats(sftp, normalizedPath);
                            if (!finalStats.isDirectory()) {
                                throw new Error(`路径 ${normalizedPath} 已存在但不是目录`);
                            }
                            logger.info('远端目录已由并发操作创建', { path: normalizedPath });
                        } catch (finalStatError) {
                            throw iterativeMkdirError;
                        }
                    }
                }
            } else {
                throw new Error(`检查目录失败 ${normalizedPath}: ${statError.message}`);
            }
        }
    }

    listDirectory(sftp: SFTPWrapper, path: string): Promise<SftpDirEntry[]> {
        return new Promise((resolve, reject) => {
            sftp.readdir(path, (err, list) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(list as SftpDirEntry[]);
                }
            });
        });
    }

    rename(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            sftp.rename(oldPath, newPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}
