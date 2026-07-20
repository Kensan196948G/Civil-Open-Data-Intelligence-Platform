export const WORKER_ROUTE_PLACEHOLDER_TYPE = "AAAA";
export const WORKER_ROUTE_PLACEHOLDER_CONTENT = "100::";

function isExpectedWorkerRouteRecord(record) {
  return (
    record?.type === WORKER_ROUTE_PLACEHOLDER_TYPE &&
    String(record?.content ?? "").toLowerCase() === WORKER_ROUTE_PLACEHOLDER_CONTENT &&
    record?.proxied === true
  );
}

function summarizeRecord(record) {
  const type = record?.type || "<unknown>";
  const proxied = typeof record?.proxied === "boolean" ? record.proxied : "<unknown>";
  const content = record?.content ? String(record.content) : "<empty>";
  return `${type} ${content} (proxied=${proxied})`;
}

export function planWorkerRouteDnsRecord(records, hostname) {
  if (!Array.isArray(records) || records.length === 0) {
    return {
      action: "create",
      message: `create proxied ${WORKER_ROUTE_PLACEHOLDER_TYPE} ${WORKER_ROUTE_PLACEHOLDER_CONTENT} record for ${hostname}`,
    };
  }

  const reusable = records.find(isExpectedWorkerRouteRecord);
  if (reusable) {
    return {
      action: "reuse",
      record: reusable,
      message: `reuse Worker route placeholder DNS record for ${hostname}`,
    };
  }

  return {
    action: "block",
    message:
      `DNS record for ${hostname} already exists but is not the expected Worker route placeholder ` +
      `(${WORKER_ROUTE_PLACEHOLDER_TYPE} ${WORKER_ROUTE_PLACEHOLDER_CONTENT}, proxied=true): ` +
      records.map(summarizeRecord).join("; "),
  };
}
