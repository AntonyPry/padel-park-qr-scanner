module.exports = (sequelize, DataTypes) => {
  const Utilizations = sequelize.define('Utilizations', {
    date: {
      type: DataTypes.DATEONLY,
      primaryKey: true,
      allowNull: false,
    },
    // Корт 1 на 1 (бывший booked6)
    booked1: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },
    // Корты 2 на 2 (бывший booked15)
    booked2: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },
    // Новые поля для сессий
    sessions1: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    sessions2: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  });
  return Utilization;
};
