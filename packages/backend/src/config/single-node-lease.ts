import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface SingleNodeLease {
  enabled: boolean;
  release: () => void;
}

const readBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('SINGLE_NODE_LOCK_ENABLED must be true or false.');
};

export const resolveSingleNodeLeaseEnabled = (
  environment: Record<string, string | undefined> = process.env,
): boolean => readBoolean(
  environment.SINGLE_NODE_LOCK_ENABLED,
  environment.FANTETIC_APP_MODE !== 'electron',
);

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * SQLite sessions, nonce replay state and uploads are all local to one data
 * directory. This lease prevents two Web processes from accidentally sharing
 * that directory; it is deliberately not a replacement for distributed HA.
 */
export const acquireSingleNodeLease = ({
                                         appDataPath,
                                         enabled,
                                         instanceId = crypto.randomUUID(),
                                       }: {
  appDataPath: string;
  enabled: boolean;
  instanceId?: string;
}): SingleNodeLease => {

  if (!enabled) {
    return {
      enabled: false,
      release: () => undefined,
    };
  }


  const runtimePath = path.join(appDataPath, 'runtime');
  const lockPath = path.join(runtimePath, 'single-node.lock');

  fs.mkdirSync(runtimePath, {
    recursive: true,
    mode: 0o700,
  });


  const leaseToken = crypto.randomUUID();


  const createLock = () => {

    const descriptor = fs.openSync(
        lockPath,
        'wx',
        0o600
    );

    try {

      fs.writeFileSync(
          descriptor,
          JSON.stringify({
            instanceId,
            leaseToken,
            pid: process.pid,
            startedAt: Date.now(),
          }),
          'utf8'
      );

    } finally {

      fs.closeSync(descriptor);

    }
  };


  try {

    createLock();

  } catch (error) {


    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }


    // 已存在锁
    let stale = false;


    try {

      const content = JSON.parse(
          fs.readFileSync(lockPath,'utf8')
      ) as {
        pid?: number;
      };


      if (
          !content.pid ||
          !isProcessRunning(content.pid)
      ) {
        stale = true;
      }


    } catch {

      stale = true;

    }


    if (!stale) {

      throw new Error(
          'Another Fantetic Terminal node already owns the shared data directory.'
      );

    }


    // 清理旧锁
    try {

      fs.unlinkSync(lockPath);

    } catch(err){

      if(
          (err as NodeJS.ErrnoException).code !== 'ENOENT'
      ){
        throw err;
      }

    }


    //重新创建
    createLock();

  }



  let released=false;


  return {

    enabled:true,


    release:()=>{

      if(released)return;

      released=true;


      try{

        const content = JSON.parse(
            fs.readFileSync(lockPath,'utf8')
        ) as {
          leaseToken?:string;
        };


        if(content.leaseToken===leaseToken){
          fs.unlinkSync(lockPath);
        }


      }catch(error){

        if(
            (error as NodeJS.ErrnoException).code !== 'ENOENT'
        ){
          throw error;
        }

      }

    }

  };

};
