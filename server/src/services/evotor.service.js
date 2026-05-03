// src/services/evotor.service.js
const db = require('../../models');

class EvotorService {
  /**
   * Главный метод обработки входящего вебхука
   * @param {Object} payload - req.body от Эвотора
   * @returns {Object} { alreadyProcessed: boolean, receipt: Object }
   */
  async processReceipt(payload) {
    // 1. Извлекаем данные чека
    const receiptData =
      payload.data && payload.type?.toLowerCase().includes('receipt')
        ? payload.data
        : payload;

    // Уникальный ID чека
    const evotorId = String(
      receiptData.id || receiptData.receiptId || receiptData.uuid || Date.now(),
    );

    // 2. Проверяем дубликаты
    const existing = await db.Receipt.findOne({ where: { evotorId } });
    if (existing) {
      return { alreadyProcessed: true };
    }

    // 3. Считаем суммы и определяем тип оплаты
    const totalAmt = Number(receiptData.totalAmount) || 0;
    const isPayback = receiptData.type === 'PAYBACK';
    const multiplier = isPayback ? -1 : 1;

    let cash = 0;
    let cashless = 0;

    // Новый формат Эвотора (тип оплаты в корне)
    if (receiptData.paymentSource === 'PAY_CARD') {
      cashless = totalAmt * multiplier;
    } else if (receiptData.paymentSource === 'CASH') {
      cash = totalAmt * multiplier;
    } else if (Array.isArray(receiptData.payments)) {
      // Фолбек для старого формата или смешанных оплат (если Эвотор решит их прислать)
      receiptData.payments.forEach((p) => {
        const amt = (Number(p.amount) || 0) * multiplier;
        if (p.type === 'cash') cash += amt;
        if (p.type === 'cashless') cashless += amt;
      });
    } else {
      // Если вообще ничего не понятно, пишем в безнал (частый кейс для интернет-оплат)
      cashless = totalAmt * multiplier;
    }

    // 4. Сохраняем заголовок чека
    const newReceipt = await db.Receipt.create({
      evotorId,
      dateTime: receiptData.dateTime || receiptData.closeDate || new Date(),
      type: receiptData.type || 'SELL',
      totalAmount: totalAmt * multiplier,
      cash,
      cashless,
      // Новые поля
      employeeId: receiptData.employeeId || null,
      shiftId: receiptData.shiftId || null,
      totalTax: (Number(receiptData.totalTax) || 0) * multiplier,
      totalDiscount: (Number(receiptData.totalDiscount) || 0) * multiplier,
      paymentSource: receiptData.paymentSource || 'UNKNOWN',
    });

    // 5. Парсим и сохраняем позиции (items)
    const positions = receiptData.positions || receiptData.items || [];

    if (positions.length > 0) {
      const itemsToInsert = positions.map((pos) => {
        // Базовые поля
        const quantity = Number(pos.quantity) || 1;
        const price = Number(pos.price) || 0;

        // В Эвоторе sumPrice - это обычно итоговая сумма позиции со всеми скидками
        // Если её нет, считаем по старинке
        let finalSum = Number(pos.sumPrice);
        if (isNaN(finalSum)) {
          finalSum = Number(pos.resultPrice || pos.sum || quantity * price);
        }

        return {
          receiptId: newReceipt.id,
          name: pos.name || 'Неизвестный товар',
          quantity: quantity * multiplier,
          price: price,
          sum: finalSum * multiplier,

          // Новые поля
          itemType: pos.itemType || null,
          measureName: pos.measureName || null,
          costPrice: Number(pos.costPrice) || 0,
          sumPrice: finalSum * multiplier,
          tax: (Number(pos.tax) || 0) * multiplier,
          taxPercent: Number(pos.taxPercent) || 0,
          discount: (Number(pos.discount) || 0) * multiplier,
        };
      });

      await db.ReceiptItem.bulkCreate(itemsToInsert);
    }

    return {
      alreadyProcessed: false,
      receipt: newReceipt,
    };
  }
}

module.exports = new EvotorService();
