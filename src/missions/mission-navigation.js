export function notificationDestination(item) {
  return item?.mission_id ? `mission:${item.mission_id}` : item?.request_id || null;
}

export function missionIdFromDestination(destination) {
  return typeof destination === 'string' && /^mission:[0-9a-f-]{36}$/i.test(destination)
    ? destination.slice(8) : null;
}
