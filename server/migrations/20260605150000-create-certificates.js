'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Certificates', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      code: {
        allowNull: false,
        type: Sequelize.STRING,
        unique: true,
      },
      clientId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      pendingSaleId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        unique: true,
        references: {
          model: 'PendingSales',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      sourceReceiptId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Receipts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      sourceReceiptItemId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        unique: true,
        references: {
          model: 'ReceiptItems',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      source: {
        allowNull: false,
        defaultValue: 'evotor_pending_sale',
        type: Sequelize.STRING,
      },
      certificateType: {
        allowNull: false,
        defaultValue: 'money',
        type: Sequelize.STRING,
      },
      title: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      serviceType: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      serviceName: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      amountTotal: {
        allowNull: true,
        type: Sequelize.DECIMAL(10, 2),
      },
      amountUsed: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.DECIMAL(10, 2),
      },
      unitsTotal: {
        allowNull: true,
        type: Sequelize.INTEGER,
      },
      unitsUsed: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.INTEGER,
      },
      startsAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      expiresAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.STRING,
      },
      saleAmount: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.DECIMAL(10, 2),
      },
      metadata: {
        allowNull: true,
        type: Sequelize.JSON,
      },
      createdByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      canceledAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      canceledByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      cancelReason: {
        allowNull: true,
        type: Sequelize.TEXT,
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

    await queryInterface.addIndex('Certificates', ['code'], {
      name: 'certificates_code_unique',
      unique: true,
    });
    await queryInterface.addIndex('Certificates', ['clientId', 'status'], {
      name: 'certificates_client_status_idx',
    });
    await queryInterface.addIndex('Certificates', ['certificateType', 'status'], {
      name: 'certificates_type_status_idx',
    });
    await queryInterface.addIndex('Certificates', ['expiresAt'], {
      name: 'certificates_expires_at_idx',
    });

    await queryInterface.createTable('CertificateRedemptions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      certificateId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: {
          model: 'Certificates',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      clientId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      amount: {
        allowNull: true,
        type: Sequelize.DECIMAL(10, 2),
      },
      quantity: {
        allowNull: true,
        type: Sequelize.INTEGER,
      },
      serviceType: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      serviceName: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      redeemedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      redeemedByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      comment: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.STRING,
      },
      reversedAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      reversedByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      reversalReason: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      metadata: {
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

    await queryInterface.addIndex(
      'CertificateRedemptions',
      ['certificateId', 'status'],
      { name: 'certificate_redemptions_certificate_status_idx' },
    );
    await queryInterface.addIndex(
      'CertificateRedemptions',
      ['clientId', 'redeemedAt'],
      { name: 'certificate_redemptions_client_date_idx' },
    );
    await queryInterface.addIndex(
      'CertificateRedemptions',
      ['redeemedByAccountId'],
      { name: 'certificate_redemptions_redeemed_by_idx' },
    );
    await queryInterface.addIndex(
      'CertificateRedemptions',
      ['reversedByAccountId'],
      { name: 'certificate_redemptions_reversed_by_idx' },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'CertificateRedemptions',
      'certificate_redemptions_reversed_by_idx',
    );
    await queryInterface.removeIndex(
      'CertificateRedemptions',
      'certificate_redemptions_redeemed_by_idx',
    );
    await queryInterface.removeIndex(
      'CertificateRedemptions',
      'certificate_redemptions_client_date_idx',
    );
    await queryInterface.removeIndex(
      'CertificateRedemptions',
      'certificate_redemptions_certificate_status_idx',
    );
    await queryInterface.dropTable('CertificateRedemptions');

    await queryInterface.removeIndex('Certificates', 'certificates_expires_at_idx');
    await queryInterface.removeIndex('Certificates', 'certificates_type_status_idx');
    await queryInterface.removeIndex('Certificates', 'certificates_client_status_idx');
    await queryInterface.removeIndex('Certificates', 'certificates_code_unique');
    await queryInterface.dropTable('Certificates');
  },
};
