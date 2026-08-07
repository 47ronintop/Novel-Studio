/**
 * Runs package-bound evidence independently from release-readiness metadata.
 * Callers still aggregate every failure, but a currently Blocked evidence
 * manifest cannot suppress the very qualification/E2E evidence needed to
 * unblock it.
 */
export async function runStrictPackagedQualificationChecks({
  verifyLayout,
  verifyOwnerQualification,
  runPackagedE2e
}) {
  const packageDirectory = await verifyLayout();
  if (packageDirectory === undefined) return;
  if (!(await verifyOwnerQualification(packageDirectory))) return;
  await runPackagedE2e(packageDirectory);
}
