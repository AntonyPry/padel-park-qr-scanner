# Двухфакторная аутентификация

## Граница релиза

SEC-A7 добавляет application capability с opt-in подключением. Автоматическое
включение для владельцев, сотрудников или операторов и любые production-флаги в
эту ветку не входят.

Смена или восстановление пароля не изменяет состояние двухфакторной
аутентификации. Восстановить потерянный фактор сотрудника может владелец того же
клуба, а фактор владельца — installation operator. Сброс фактора завершает все
сессии затронутого аккаунта и не меняет пароль, роль, membership или tenant
scope.

## Шифрование данных аутентификации

Приложение принимает отдельный key ring:

- `AUTH_DATA_ENCRYPTION_KEY_RING` — JSON object размером не более 8 KiB и не
  более 16 версий;
- ключ объекта — каноническое положительное десятичное число без ведущих нулей;
- значение — base64url без padding, декодирующееся ровно в 32 байта;
- `AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION` — положительная версия,
  присутствующая в ring.

Новые записи используют текущую версию. Чтение использует версию envelope.
Отсутствующая версия, неверная конфигурация, несовпадение AAD или ошибка
аутентификации ciphertext завершаются fail closed.

Envelope содержит только `schemaVersion`, `algorithm=A256GCM`, `keyVersion`,
уникальный 96-bit `nonce`, `ciphertext` и 128-bit `tag`. AAD неизменно связывает
версию схемы, purpose и идентичность сущности:

- `account_two_factor` + immutable Account id;
- `installation_operator_two_factor` + immutable operatorId.

Ключи, plaintext-секреты, коды, ciphertext и содержимое ring нельзя писать в
логи, audit payload, ошибки, git, PM2 ecosystem/saved dump, shell history или
тестовые отчёты.

DevOps отвечает за генерацию, custody, distribution, rotation, отдельный
recovery escrow и доказательство backup/restore. Приложение не создаёт KMS и не
удаляет старые ключи автоматически. Production enablement требует принятого
внешнего secret source; значение env само по себе не включает rollout.

## Проверка и ротация envelope

Команда по умолчанию выполняет только dry run:

```sh
npm run auth:data-envelopes:rewrap -- --batch-size=100 --max-refs=1000
```

Явный `--apply` включает CAS-обновление:

```sh
npm run auth:data-envelopes:rewrap -- --apply --batch-size=100 --max-refs=1000
```

Команда ограничена batch/count, повторяемая и идемпотентная. Отчёт содержит
только агрегированные counts по purpose/version:
`scanned`, `decryptable`, `errors`, `wouldRewrap`, `rewrapped`, `skipped`.
Идентификаторы сущностей и содержимое envelope не выводятся.

Apply меняет запись только если ciphertext и его версия всё ещё совпадают с
прочитанными значениями. Повторный запуск пропускает уже текущую версию, поэтому
остановленный bounded run можно безопасно продолжить новым запуском.

Старая версия ключа может быть выведена из эксплуатации только после:

1. нулевого числа live references;
2. проверки текущей и rollback-версии приложения;
3. доказанного restore самого старого retained backup, которому нужен ключ;
4. истечения/уничтожения всех таких backup или сохранения recovery escrow.

Команда не должна запускаться в production из feature/QA-процесса.

## Installation operator directory

Совместимость контролирует
`INSTALLATION_OPERATOR_AUTH_MODE=legacy|static-directory`.
`static-directory` читает `INSTALLATION_OPERATOR_DIRECTORY_JSON`: bounded list
уникальных записей с immutable `operatorId`, каноническим username,
централизованно настроенным Argon2id `passwordHash`, `enabled` и положительным
`credentialVersion`.

Сессия хранит `operatorId`, auth mode и credential version. Переключение режима,
disable записи или увеличение credential version инвалидирует её сессии при
revalidation. Переименование username сохраняет stable operator identity.
Legacy operator может работать в совместимом режиме, но production-переход на
directory выполняется отдельно от этой ветки.

## Хранение и миграция

В БД сохраняются только зашифрованный shared secret, key version, монотонный
TOTP counter, хеши одноразовых резервных кодов, opaque login challenge digest и
session confirmation timestamp. Shared secret и резервные коды выдаются
пользователю только в момент подключения/перевыпуска.

Forward migration создаёт `AccountTwoFactors`,
`InstallationOperatorTwoFactors`, `TwoFactorRecoveryCodes`,
`AuthLoginChallenges` и расширяет существующие opaque session tables.
Привилегированный migrator нуждается в DDL-правах на tables, indexes, foreign
keys, enums и triggers. Runtime получает только необходимые DML-права и не
должен иметь DDL-права.

Rollback удаляет схему только пока в новых таблицах нет security history и в
session tables нет evidence использования. После enrollment безопасный rollback
сохраняет старые ключи и данные; автоматическое удаление или plaintext downgrade
запрещены.
