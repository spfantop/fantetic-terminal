import { getDbInstance } from '../database/connection';
import { verifyAuditLogChain } from './audit.repository';

export const verifyConfiguredAuditChain = async (): Promise<void> => {
  const verification = await verifyAuditLogChain(await getDbInstance());
  if (!verification.valid) {
    throw new Error(`Audit hash chain verification failed: ${verification.error}`);
  }
  console.log(JSON.stringify(verification));
};

if (require.main === module) {
  verifyConfiguredAuditChain().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
