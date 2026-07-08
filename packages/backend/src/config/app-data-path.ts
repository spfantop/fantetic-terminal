import fs from 'fs';
import path from 'path';

type ResolveAppDataPathInput = {
    providedBackendDataPath?: string;
    compiledConfigDir: string;
};

let effectiveAppDataPath: string | null = null;

export const resolveAppDataPath = ({
    providedBackendDataPath,
    compiledConfigDir,
}: ResolveAppDataPathInput): string => {
    if (providedBackendDataPath && providedBackendDataPath.trim().length > 0) {
        return providedBackendDataPath;
    }

    return path.resolve(compiledConfigDir, '..', '..', 'app-data-backend');
};

export const initializeAppDataPath = (): string => {
    if (effectiveAppDataPath) {
        return effectiveAppDataPath;
    }

    effectiveAppDataPath = resolveAppDataPath({
        providedBackendDataPath: process.env.APP_BACKEND_DATA_PATH,
        compiledConfigDir: __dirname,
    });

    if (!fs.existsSync(effectiveAppDataPath)) {
        fs.mkdirSync(effectiveAppDataPath, { recursive: true });
    }

    return effectiveAppDataPath;
};

export const getAppDataPath = (): string => {
    return effectiveAppDataPath || initializeAppDataPath();
};

export const ensureAndGetPathInAppData = (subPath: string): string => {
    const targetPath = path.join(getAppDataPath(), subPath);
    if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
    }

    return targetPath;
};
