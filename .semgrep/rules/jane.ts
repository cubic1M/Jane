// Cases for jane.yaml. Not app code: nothing imports it.
declare const db: any, client: any, tx: any, log: any, scoped: any, scopedFor: any;
declare const id: string, userId: string, item: any, user: any, row: any;

export async function queries() {
  // ruleid: jane-user-table-query-without-scope
  await db.transaction.findMany();
  // ruleid: jane-user-table-query-without-scope
  await client.finding.findUnique({ where: { id } });
  // ruleid: jane-user-table-query-without-scope
  await tx.account.updateMany({ where: { id }, data: { name: "x" } });
  // ruleid: jane-user-table-query-without-scope
  await client.finding.deleteMany({ where: { status: "open" } });
  // ruleid: jane-user-table-query-without-scope
  await db.transaction.findMany({ where: { id }, select: { userId: true } });

  // ok: jane-user-table-query-without-scope
  await client.finding.findMany({ where: { userId } });
  // ok: jane-user-table-query-without-scope
  await client.finding.findFirst({ where: { id, userId: user.id } });
  // ok: jane-user-table-query-without-scope
  await client.finding.update({ where: { id, status: "open", userId }, data: {} });
  // ok: jane-user-table-query-without-scope
  await client.transaction.findMany({
    where: {
      account: { userId },
    },
  });
  // ok: jane-user-table-query-without-scope
  await client.janeMessage.findUnique({ where: { userId_kind: { userId, kind: "x" } } });
  // The scoped client's names are plural, and it adds the user itself.
  // ok: jane-user-table-query-without-scope
  await scoped.findings.findMany({ where: { id } });
  const db2 = scopedFor(userId);
  // ok: jane-user-table-query-without-scope
  await db2.homeEquityFacts.findFirst();
  // ok: jane-user-table-query-without-scope
  await scopedFor(userId).homeEquityFacts.findFirst();
  // A table no one owns.
  // ok: jane-user-table-query-without-scope
  await client.merchantDirectory.findMany();
}

export function logging() {
  // ruleid: jane-log-sensitive-value
  console.error("failed", item.accessToken);
  // ruleid: jane-log-sensitive-value
  log.error("failed", { token: item.access_token });
  // ruleid: jane-log-sensitive-value
  log.info(`row ${row.description} failed`);
  // ruleid: jane-log-sensitive-value
  console.log("user", user.email);
  // ruleid: jane-log-sensitive-value
  log.warn("uploaded", { first: statementText });

  // ok: jane-log-sensitive-value
  log.error("failed", { itemId: item.id, status: 500 });
  // ok: jane-log-sensitive-value
  console.error("failed", { userId });
  // ok: jane-log-sensitive-value
  log.info("rows", { count: row.descriptions });
}
declare const statementText: string;
