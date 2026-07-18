const { ACCOUNT_ROLE_VALUES } = require('../constants/account-roles');

const ONBOARDING_QUEST_TASK_HEADER = 'X-Onboarding-Quest-Task-Key';
const ONBOARDING_QUEST_ROLE_HEADER = 'X-Onboarding-Quest-Role';
const ONBOARDING_PROGRESSED_TASKS_HEADER = 'X-Onboarding-Progressed-Task-Keys';
const ONBOARDING_COMPLETED_TASKS_HEADER = 'X-Onboarding-Completed-Task-Keys';

function normalizeTaskKey(value) {
  if (typeof value !== 'string') return undefined;
  const taskKey = value.trim();
  if (!taskKey || taskKey.length > 160 || !/^[a-z0-9][a-z0-9._-]*$/i.test(taskKey)) {
    return undefined;
  }
  return taskKey;
}

function normalizeRole(value) {
  if (!value || !ACCOUNT_ROLE_VALUES.includes(value)) return undefined;
  return value;
}

function captureOnboardingQuest() {
  return (req, _res, next) => {
    const taskKey = normalizeTaskKey(req.get(ONBOARDING_QUEST_TASK_HEADER));
    const role = normalizeRole(req.get(ONBOARDING_QUEST_ROLE_HEADER));

    req.onboardingQuest = taskKey
      ? {
          ...(role ? { role } : {}),
          taskKey,
        }
      : undefined;

    next();
  };
}

function setOnboardingEventResultHeaders(res, result) {
  const progressedTaskKeys = result?.progressedTaskKeys || [];
  const completedTaskKeys = result?.completedTaskKeys || [];

  if (progressedTaskKeys.length > 0) {
    res.set(ONBOARDING_PROGRESSED_TASKS_HEADER, progressedTaskKeys.join(','));
  }
  if (completedTaskKeys.length > 0) {
    res.set(ONBOARDING_COMPLETED_TASKS_HEADER, completedTaskKeys.join(','));
  }
}

module.exports = {
  ONBOARDING_COMPLETED_TASKS_HEADER,
  ONBOARDING_PROGRESSED_TASKS_HEADER,
  ONBOARDING_QUEST_ROLE_HEADER,
  ONBOARDING_QUEST_TASK_HEADER,
  captureOnboardingQuest,
  setOnboardingEventResultHeaders,
};
