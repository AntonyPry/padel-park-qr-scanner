'use strict';

module.exports = (sequelize, DataTypes) => sequelize.define(
  'AuthLoginChallenge',
  {
    id: {
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      type: DataTypes.UUID,
    },
    subjectKind: {
      allowNull: false,
      type: DataTypes.ENUM('account', 'installation_operator'),
    },
    accountId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    operatorId: {
      allowNull: true,
      type: DataTypes.STRING(80),
    },
    operatorAuthMode: {
      allowNull: true,
      type: DataTypes.ENUM('legacy', 'static-directory'),
    },
    operatorCredentialVersion: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    purpose: {
      allowNull: false,
      type: DataTypes.ENUM('login', 'required_enrollment'),
    },
    tokenDigest: {
      allowNull: false,
      type: DataTypes.CHAR(64).BINARY,
      unique: true,
    },
    expiresAt: {
      allowNull: false,
      type: DataTypes.DATE,
    },
    consumedAt: {
      allowNull: true,
      type: DataTypes.DATE,
    },
  },
  {
    defaultScope: {
      attributes: { exclude: ['tokenDigest'] },
    },
    tableName: 'AuthLoginChallenges',
  },
);
