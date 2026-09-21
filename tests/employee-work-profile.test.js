import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEmployeeUpdate } from '../src/auth/account-rules.js';

const employee = { name: 'Employee', email: 'employee@example.com', phone: '+966500000001', jobTitle: 'Designer' };
const id = '00000000-0000-4000-8000-000000000001';
const profile = { services: [], expected_services: [], capacity: 5, expected_capacity: 5,
  coordinator: true, expected_coordinator: false, employment_type: 'freelancer', expected_employment_type: null };

test('legacy employee updates preserve omitted work settings', () => {
  assert.equal(validateEmployeeUpdate(employee).value.workProfile, undefined);
});
test('coordinators can save without physical departments and membership lists support multiple departments', () => {
  assert.deepEqual(validateEmployeeUpdate({ ...employee, workProfile: profile }).value.workProfile, profile);
  const value = validateEmployeeUpdate({ ...employee, workProfile: { ...profile, services: [id, id], untrusted: 'ignored' } }).value;
  assert.deepEqual(value.workProfile.services, [id]);
  assert.equal(value.workProfile.untrusted, undefined);
});
test('invalid employment and stale-snapshot payload shapes are rejected', () => {
  for (const patch of [{ employment_type: '' }, { coordinator: 'true' }, { services: ['bad'] },
    { expected_services: null }, { expected_employment_type: undefined }, { capacity: 1.5 }, { capacity: 101 }, { expected_capacity: 0 }]) {
    assert.ok(validateEmployeeUpdate({ ...employee, workProfile: { ...profile, ...patch } }).error, JSON.stringify(patch));
  }
});
