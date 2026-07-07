'use strict';

const TEMPLATE_SEEDS = [
  {
    description: 'Проверки открытия клуба перед первыми гостями.',
    gracePeriodMinutes: 30,
    name: 'Утренний отчет об открытии',
    scheduleConfig: { times: ['09:00'] },
    scheduleType: 'daily_times',
    sortOrder: 10,
    items: [
      {
        itemType: 'checkbox',
        label: 'Ресепшен и зона входа готовы к приему гостей',
        photoRequired: true,
        sortOrder: 10,
      },
      {
        itemType: 'text',
        label: 'Что нужно передать следующей смене',
        sortOrder: 20,
      },
    ],
  },
  {
    description: 'Периодический контроль санитарной зоны в течение дня.',
    gracePeriodMinutes: 20,
    name: 'Промежуточный отчет санитарной зоны',
    scheduleConfig: { times: ['12:00', '15:00', '18:00', '21:00'] },
    scheduleType: 'daily_times',
    sortOrder: 20,
    items: [
      {
        itemType: 'checkbox',
        label: 'Санитарная зона проверена и приведена в порядок',
        photoRequired: true,
        sortOrder: 10,
      },
      {
        itemType: 'text',
        label: 'Что нужно пополнить или исправить',
        sortOrder: 20,
      },
    ],
  },
  {
    description: 'Контроль закрытия смены и передачи клуба.',
    gracePeriodMinutes: 45,
    name: 'Вечерний отчет о закрытии',
    scheduleConfig: { times: ['21:30'] },
    scheduleType: 'daily_times',
    sortOrder: 30,
    items: [
      {
        itemType: 'checkbox',
        label: 'Клуб подготовлен к закрытию',
        photoRequired: true,
        sortOrder: 10,
      },
      {
        itemType: 'text',
        label: 'Комментарий по итогам смены',
        sortOrder: 20,
      },
    ],
  },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ShiftReportTemplates', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      name: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      description: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.STRING,
      },
      scheduleType: {
        allowNull: false,
        defaultValue: 'daily_times',
        type: Sequelize.STRING,
      },
      scheduleConfig: {
        allowNull: true,
        type: Sequelize.JSON,
      },
      appliesToRole: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      appliesToShiftType: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      gracePeriodMinutes: {
        allowNull: false,
        defaultValue: 30,
        type: Sequelize.INTEGER,
      },
      version: {
        allowNull: false,
        defaultValue: 1,
        type: Sequelize.INTEGER,
      },
      sortOrder: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.INTEGER,
      },
      archivedAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      createdByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          key: 'id',
          model: 'Accounts',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      updatedByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          key: 'id',
          model: 'Accounts',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.createTable('ShiftReportTemplateItems', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      templateId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: {
          key: 'id',
          model: 'ShiftReportTemplates',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      label: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      itemType: {
        allowNull: false,
        defaultValue: 'checkbox',
        type: Sequelize.STRING,
      },
      photoRequired: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      sortOrder: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.INTEGER,
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.STRING,
      },
      archivedAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.createTable('ShiftReports', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      shiftId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: {
          key: 'id',
          model: 'Shifts',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      templateId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          key: 'id',
          model: 'ShiftReportTemplates',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      templateVersion: {
        allowNull: false,
        defaultValue: 1,
        type: Sequelize.INTEGER,
      },
      templateSnapshot: {
        allowNull: false,
        type: Sequelize.JSON,
      },
      itemsSnapshot: {
        allowNull: false,
        type: Sequelize.JSON,
      },
      scheduledAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      scheduledSlotKey: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      submittedAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      submittedByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          key: 'id',
          model: 'Accounts',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      comment: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      status: {
        allowNull: false,
        defaultValue: 'pending',
        type: Sequelize.STRING,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.createTable('ShiftReportAnswers', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      reportId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: {
          key: 'id',
          model: 'ShiftReports',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      templateItemId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          key: 'id',
          model: 'ShiftReportTemplateItems',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      itemSnapshot: {
        allowNull: false,
        type: Sequelize.JSON,
      },
      itemLabel: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      itemType: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      photoRequired: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      booleanValue: {
        allowNull: true,
        type: Sequelize.BOOLEAN,
      },
      textValue: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      numberValue: {
        allowNull: true,
        type: Sequelize.DECIMAL(12, 2),
      },
      attachments: {
        allowNull: true,
        type: Sequelize.JSON,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.addIndex('ShiftReportTemplates', ['status', 'sortOrder'], {
      name: 'shift_report_templates_status_sort_idx',
    });
    await queryInterface.addIndex('ShiftReportTemplateItems', ['templateId', 'status'], {
      name: 'shift_report_template_items_template_status_idx',
    });
    await queryInterface.addIndex('ShiftReports', ['shiftId', 'templateId', 'scheduledSlotKey'], {
      name: 'shift_reports_shift_template_slot_unique',
      unique: true,
    });
    await queryInterface.addIndex('ShiftReports', ['status', 'scheduledAt'], {
      name: 'shift_reports_status_scheduled_at_idx',
    });
    await queryInterface.addIndex('ShiftReportAnswers', ['reportId'], {
      name: 'shift_report_answers_report_idx',
    });

    const now = new Date();
    await queryInterface.bulkInsert(
      'ShiftReportTemplates',
      TEMPLATE_SEEDS.map((template) => ({
        description: template.description,
        gracePeriodMinutes: template.gracePeriodMinutes,
        name: template.name,
        scheduleConfig: JSON.stringify(template.scheduleConfig),
        scheduleType: template.scheduleType,
        sortOrder: template.sortOrder,
        status: 'active',
        version: 1,
        createdAt: now,
        updatedAt: now,
      })),
    );

    const [templates] = await queryInterface.sequelize.query(
      'SELECT id, name FROM ShiftReportTemplates WHERE name IN (:names)',
      {
        replacements: {
          names: TEMPLATE_SEEDS.map((template) => template.name),
        },
      },
    );
    const templateIdByName = new Map(templates.map((template) => [template.name, template.id]));

    await queryInterface.bulkInsert(
      'ShiftReportTemplateItems',
      TEMPLATE_SEEDS.flatMap((template) =>
        template.items.map((item) => ({
          itemType: item.itemType,
          label: item.label,
          photoRequired: Boolean(item.photoRequired),
          sortOrder: item.sortOrder,
          status: 'active',
          templateId: templateIdByName.get(template.name),
          createdAt: now,
          updatedAt: now,
        })),
      ),
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ShiftReportAnswers');
    await queryInterface.dropTable('ShiftReports');
    await queryInterface.dropTable('ShiftReportTemplateItems');
    await queryInterface.dropTable('ShiftReportTemplates');
  },
};
