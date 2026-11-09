"use client";

import { PageHeading } from "@aij/ui";
import { Alert, Button, Descriptions, Form, Input, Modal, Select, Space, Table, Tag, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { requestMessage } from "./admin-api";
import { useAdmin } from "./admin-shell";

type PaymentOrder = {
  id: string; orderNo: string; payableReference: string; payableOwner: string;
  amountMinor: string; currency: string; currencyExponent: number; status: string; createdAt: string;
  attempts: { id: string; attemptNumber: number; providerCode: string; status: string; submittedAt: string | null; observedAt: string | null }[];
  transactions: { id: string; kind: string; amountMinor: string; currency: string; occurredAt: string; recordedAt: string }[];
  callbackEvents: { status: string; failureCode: string | null; receivedAt: string; processedAt: string | null }[];
};
type RefundRequest = { id: string; orderId: string; orderNo: string; amountMinor: string; currency: string; currencyExponent: number; reason: string; status: string; requestedAt: string; requester: { username: string; realName: string } };
type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
const statusNames: Record<string, string> = { created: "已创建", pending: "处理中", succeeded: "已支付", failed: "失败", closed: "已关闭", pending_manual_review: "待人工处理" };
const money = (amountMinor: string, currency: string, exponent: number) => {
  const normalized = amountMinor.padStart(exponent + 1, "0");
  return exponent ? `${currency} ${normalized.slice(0, -exponent)}.${normalized.slice(-exponent)}` : `${currency} ${normalized}`;
};

export function AdminPayments() {
  const { request, can } = useAdmin();
  const [orders, setOrders] = useState<Page<PaymentOrder>>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [refunds, setRefunds] = useState<Page<RefundRequest>>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [page, setPage] = useState(1), [status, setStatus] = useState<string | undefined>();
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [selected, setSelected] = useState<PaymentOrder | null>(null), [refundTarget, setRefundTarget] = useState<PaymentOrder | null>(null);
  const [submitting, setSubmitting] = useState(false), [form] = Form.useForm<{ amountMinor: string; reason: string }>();
  const canRequestRefund = can("admin.payment.refund.request");

  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "20", ...(status ? { status } : {}) });
      const [orderResult, refundResult] = await Promise.all([
        request<Page<PaymentOrder>>(`/admin/payments/orders?${query.toString()}`),
        request<Page<RefundRequest>>("/admin/payments/refund-requests?page=1&pageSize=20")
      ]);
      setOrders(orderResult); setRefunds(refundResult);
    } catch (failure) { setError(requestMessage(failure)); }
    finally { setLoading(false); }
  }, [page, request, status]);
  useEffect(() => { const timer = setTimeout(() => void reload(), 0); return () => clearTimeout(timer); }, [reload]);

  async function showOrder(id: string) {
    try { setSelected(await request<PaymentOrder>(`/admin/payments/orders/${encodeURIComponent(id)}`)); }
    catch (failure) { setError(requestMessage(failure)); }
  }
  async function submitRefund() {
    if (!refundTarget || !canRequestRefund) return;
    const values = await form.validateFields(); setSubmitting(true);
    try {
      const key = globalThis.crypto.randomUUID().replaceAll("-", "");
      const result = await request<RefundRequest>(`/admin/payments/orders/${encodeURIComponent(refundTarget.id)}/refund-requests`, "POST", { ...values, idempotencyKey: key });
      message.success(`退款申请 ${result.id} 已登记，等待人工处理`);
      setRefundTarget(null); form.resetFields(); await reload();
    } catch (failure) { setError(requestMessage(failure)); }
    finally { setSubmitting(false); }
  }

  const orderColumns = [
    { title: "支付单号", dataIndex: "orderNo", key: "orderNo", render: (value: string, row: PaymentOrder) => <Button type="link" onClick={() => void showOrder(row.id)}>{value}</Button> },
    { title: "金额", key: "amount", render: (_: unknown, row: PaymentOrder) => money(row.amountMinor, row.currency, row.currencyExponent) },
    { title: "状态", dataIndex: "status", key: "status", render: (value: string) => <Tag>{statusNames[value] ?? value}</Tag> },
    { title: "创建时间", dataIndex: "createdAt", key: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
    { title: "操作", key: "actions", render: (_: unknown, row: PaymentOrder) => <Space><Button onClick={() => void showOrder(row.id)}>详情</Button>{canRequestRefund && row.status === "succeeded" && <Button onClick={() => { setRefundTarget(row); form.setFieldsValue({ amountMinor: "", reason: "" }); }}>申请人工退款</Button>}</Space> }
  ];
  const refundColumns = [
    { title: "支付单号", dataIndex: "orderNo", key: "orderNo" },
    { title: "申请金额", key: "amount", render: (_: unknown, row: RefundRequest) => money(row.amountMinor, row.currency, row.currencyExponent) },
    { title: "状态", dataIndex: "status", key: "status", render: (value: string) => <Tag color="gold">{statusNames[value] ?? value}</Tag> },
    { title: "申请人", key: "requester", render: (_: unknown, row: RefundRequest) => row.requester.realName || row.requester.username },
    { title: "申请时间", dataIndex: "requestedAt", key: "requestedAt", render: (value: string) => new Date(value).toLocaleString() }
  ];

  return <>
    <PageHeading eyebrow="支付 · 管理" title="支付订单与人工退款申请" description="仅查询当前项目支付账本。申请只登记待处理事项，不会向 Provider 发起退款。" actions={<Button onClick={() => void reload()}>刷新</Button>} />
    {error && <div role="alert" className="admin-feedback"><Alert type="error" showIcon title={error} /></div>}
    <Alert type="info" showIcon message="资金操作保护" description="本页面仅登记人工退款申请。没有自动退款、扣款或生产 Provider 调用。" style={{ marginBottom: 16 }} />
    <section className="admin-table-panel" aria-label="支付订单">
      <Space wrap style={{ padding: 20 }}><span>订单状态</span><Select aria-label="订单状态" allowClear value={status} onChange={value => { setPage(1); setStatus(value); }} options={["created", "pending", "succeeded", "failed", "closed"].map(value => ({ value, label: statusNames[value] }))} /><Button onClick={() => { setPage(1); setStatus(undefined); }}>清除筛选</Button></Space>
      <Table<PaymentOrder> rowKey="id" dataSource={orders.items} columns={orderColumns} loading={loading} pagination={false} scroll={{ x: 850 }} locale={{ emptyText: "没有匹配的支付订单。" }} />
      <Space style={{ padding: 16, justifyContent: "flex-end", width: "100%" }}><span>共 {orders.total} 条，第 {page} 页</span><Button disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>上一页</Button><Button disabled={page * 20 >= orders.total || loading} onClick={() => setPage(value => value + 1)}>下一页</Button></Space>
    </section>
    <section className="admin-table-panel" aria-label="待人工处理退款申请" style={{ marginTop: 24 }}>
      <div style={{ padding: "18px 20px 0" }}><h2>人工退款申请</h2><p className="admin-help">申请记录不会触发 Provider；支付执行仍须负责人另行处理。</p></div>
      <Table<RefundRequest> rowKey="id" dataSource={refunds.items} columns={refundColumns} loading={loading} pagination={false} scroll={{ x: 720 }} locale={{ emptyText: "暂无人工退款申请。" }} />
    </section>
    <Modal title="支付订单详情" open={!!selected} onCancel={() => setSelected(null)} footer={null} width={720}>
      {selected && <Descriptions bordered column={1} size="small"><Descriptions.Item label="支付单号">{selected.orderNo}</Descriptions.Item><Descriptions.Item label="状态">{statusNames[selected.status] ?? selected.status}</Descriptions.Item><Descriptions.Item label="金额">{money(selected.amountMinor, selected.currency, selected.currencyExponent)}</Descriptions.Item><Descriptions.Item label="业务引用">{selected.payableReference}</Descriptions.Item><Descriptions.Item label="Provider 尝试">{selected.attempts.map(attempt => `${attempt.providerCode} · ${statusNames[attempt.status] ?? attempt.status}`).join("；") || "无"}</Descriptions.Item><Descriptions.Item label="账本交易">{selected.transactions.map(transaction => `${transaction.kind} ${money(transaction.amountMinor, transaction.currency, selected.currencyExponent)}`).join("；") || "无"}</Descriptions.Item><Descriptions.Item label="回调处理">{selected.callbackEvents.map(event => `${statusNames[event.status] ?? event.status}${event.failureCode ? `（${event.failureCode}）` : ""}`).join("；") || "无"}</Descriptions.Item></Descriptions>}
    </Modal>
    <Modal title="登记人工退款申请" open={!!refundTarget} onCancel={() => { setRefundTarget(null); form.resetFields(); }} onOk={() => void submitRefund()} confirmLoading={submitting} okText="提交申请" cancelText="取消">
      {refundTarget && <><p>支付单：{refundTarget.orderNo} · 可退上限将由服务端按实际交易重新核对。</p><Form form={form} layout="vertical"><Form.Item name="amountMinor" label={`申请金额（货币最小单位，${refundTarget.currency}）`} rules={[{ required: true }, { pattern: /^[1-9][0-9]{0,17}$/, message: "请输入正整数金额" }]}><Input maxLength={18} inputMode="numeric" /></Form.Item><Form.Item name="reason" label="申请原因" rules={[{ required: true }, { min: 1 }, { max: 500 }]}><Input.TextArea maxLength={500} showCount rows={4} /></Form.Item></Form></>}
    </Modal>
  </>;
}
