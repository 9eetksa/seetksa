const activeStatuses = new Set(['open', 'waiting']);

export const coordinatorTaskLabels = {
  intake: 'استلام الطلب ومراجعة بياناته',
  delivery_review: 'مراجعة مخرجات القسم',
  revision_review: 'مراجعة تعديل العميل وإحالته',
};

export function coordinatorTasksFor(source, requestId, userId) {
  return (Array.isArray(source.coordinator_tasks) ? source.coordinator_tasks : []).filter(task =>
    task.request_id === requestId && (
      task.assignee_id === userId || task.completed_by === userId
      || source.coordinator && !task.assignee_id && activeStatuses.has(task.status)
    ),
  );
}

export function coordinatorTaskSummary(tasks, now = Date.now()) {
  const active = tasks.filter(task => activeStatuses.has(task.status));
  const actionable = active.filter(task => task.status === 'open');
  const completed = tasks.filter(task => task.status === 'completed');
  // Score targets are measurement benchmarks and never create workflow deadlines
  const deadlines = actionable.map(task => Date.parse(task.due_at))
    .filter(Number.isFinite);
  const due = deadlines.length ? Math.min(...deadlines) : Infinity;
  // Intake is the first action of a request then client changes then output review
  const next = ['intake', 'revision_review', 'delivery_review'].map(kind => actionable.find(task => task.kind === kind)).find(Boolean);
  return {
    tasks, active, completed, due,
    open: active.length > 0,
    offered: actionable.some(task => task.kind === 'intake'),
    review: actionable.some(task => task.kind === 'delivery_review'),
    revision: actionable.some(task => task.kind === 'revision_review'),
    waiting: active.some(task => task.status === 'waiting'),
    overdue: due < now,
    nextLabel: next ? coordinatorTaskLabels[next.kind] : active.length ? 'بانتظار استكمال البيانات من المشرف لاستكمال مراجعتك' : '',
  };
}
