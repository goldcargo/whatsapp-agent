import { describe, expect, it } from "vitest";
import { buildSystemContext } from "../src/context.js";
import {
  formatBogotaDateTime,
  formatTime,
  greetingSlot,
  isBusinessHours,
  nextBusinessOpening,
} from "../src/time/business-hours.js";
import { colombianHolidays, easterSunday, toIsoDate } from "../src/time/holidays.js";

/** Hora local de Bogotá (UTC-5) → Date. */
function bogota(iso: string): Date {
  return new Date(`${iso}-05:00`);
}

describe("festivos de Colombia", () => {
  it("calcula la Pascua", () => {
    expect(toIsoDate(easterSunday(2026))).toBe("2026-04-05");
    expect(toIsoDate(easterSunday(2027))).toBe("2027-03-28");
  });

  it("lista los 18 festivos de 2026, con traslados a lunes", () => {
    const expected = [
      "2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03",
      "2026-05-01", "2026-05-18", "2026-06-08", "2026-06-15", "2026-06-29",
      "2026-07-20", "2026-08-07", "2026-08-17", "2026-10-12", "2026-11-02",
      "2026-11-16", "2026-12-08", "2026-12-25",
    ];
    expect([...colombianHolidays(2026)].sort()).toEqual(expected);
  });
});

describe("horario hábil", () => {
  it("lunes a viernes de 8:00 a.m. a 6:00 p.m.", () => {
    expect(isBusinessHours(bogota("2026-11-24T07:59"))).toBe(false);
    expect(isBusinessHours(bogota("2026-11-24T08:00"))).toBe(true);
    expect(isBusinessHours(bogota("2026-11-24T17:59"))).toBe(true);
    expect(isBusinessHours(bogota("2026-11-24T18:00"))).toBe(false);
  });

  it("sábado hasta las 12:00 m., domingo cerrado", () => {
    expect(isBusinessHours(bogota("2026-11-28T11:59"))).toBe(true);
    expect(isBusinessHours(bogota("2026-11-28T12:00"))).toBe(false);
    expect(isBusinessHours(bogota("2026-11-29T10:00"))).toBe(false);
  });

  it("festivo cerrado (lunes 16 de noviembre de 2026)", () => {
    expect(isBusinessHours(bogota("2026-11-16T10:00"))).toBe(false);
  });

  it("usa la hora de Bogotá aunque el servidor esté en UTC", () => {
    // 2026-11-25 01:00 UTC = martes 24, 8:00 p.m. en Bogotá
    expect(isBusinessHours(new Date("2026-11-25T01:00:00Z"))).toBe(false);
    expect(formatBogotaDateTime(new Date("2026-11-25T01:00:00Z"))).toBe("martes 24 de noviembre de 2026, 8:00 p.m.");
  });
});

describe("próximo horario hábil", () => {
  it("martes 9:02 p.m. → miércoles 8:00 a.m. (ejemplo de la especificación)", () => {
    expect(nextBusinessOpening(bogota("2026-11-24T21:02"))).toBe(
      "miércoles 25 de noviembre de 2026 a partir de las 8:00 a.m.",
    );
  });

  it("madrugada de día hábil → hoy a las 8:00 a.m.", () => {
    expect(nextBusinessOpening(bogota("2026-11-25T06:30"))).toBe(
      "miércoles 25 de noviembre de 2026 a partir de las 8:00 a.m.",
    );
  });

  it("domingo en la noche antes de festivo → martes (caso de prueba 11)", () => {
    // Domingo 15 nov 2026, lunes 16 es festivo
    expect(nextBusinessOpening(bogota("2026-11-15T21:00"))).toBe(
      "martes 17 de noviembre de 2026 a partir de las 8:00 a.m.",
    );
  });

  it("Semana Santa: miércoles 1 de abril de 2026 en la noche → sábado 4", () => {
    expect(nextBusinessOpening(bogota("2026-04-01T19:00"))).toBe(
      "sábado 4 de abril de 2026 a partir de las 8:00 a.m.",
    );
  });

  it("sábado después del mediodía → lunes", () => {
    expect(nextBusinessOpening(bogota("2026-11-28T13:00"))).toBe(
      "lunes 30 de noviembre de 2026 a partir de las 8:00 a.m.",
    );
  });
});

describe("franja de saludo y formato", () => {
  it("MAÑANA 5–11:59, TARDE 12–18:59, NOCHE 19–4:59", () => {
    expect(greetingSlot(bogota("2026-11-24T04:59"))).toBe("NOCHE");
    expect(greetingSlot(bogota("2026-11-24T05:00"))).toBe("MAÑANA");
    expect(greetingSlot(bogota("2026-11-24T12:00"))).toBe("TARDE");
    expect(greetingSlot(bogota("2026-11-24T18:59"))).toBe("TARDE");
    expect(greetingSlot(bogota("2026-11-24T19:00"))).toBe("NOCHE");
  });

  it("formatea horas", () => {
    expect(formatTime(0, 5)).toBe("12:05 a.m.");
    expect(formatTime(12, 0)).toBe("12:00 m.");
    expect(formatTime(12, 30)).toBe("12:30 p.m.");
    expect(formatTime(21, 2)).toBe("9:02 p.m.");
  });
});

describe("CONTEXTO_SISTEMA", () => {
  it("genera el bloque de la sección 1.3", () => {
    const ctx = buildSystemContext({
      now: bogota("2026-11-24T21:02"),
      phone: "+573001234567",
      origin: "ENTRANTE",
      handoffDone: false,
    });
    expect(ctx).toBe(
      [
        "[CONTEXTO_SISTEMA]",
        "fecha_hora_bogota: martes 24 de noviembre de 2026, 9:02 p.m.",
        "franja_saludo: NOCHE",
        "horario_habil: NO",
        "proximo_horario_habil: miércoles 25 de noviembre de 2026 a partir de las 8:00 a.m.",
        "telefono_whatsapp: +573001234567",
        "origen_conversacion: ENTRANTE",
        "datos_base: No aplica",
        "traspaso_realizado: NO",
        "[/CONTEXTO_SISTEMA]",
      ].join("\n"),
    );
  });

  it("incluye datos_base en remarketing y limpia saltos de línea", () => {
    const ctx = buildSystemContext({
      now: bogota("2026-11-24T10:00"),
      phone: "+573001234567",
      origin: "REMARKETING_CLIENTE_INACTIVO",
      baseData: { nombre: "Ana\nRuiz", empresa: "Andes; SAS" },
      handoffDone: true,
    });
    expect(ctx).toContain("datos_base: nombre=Ana Ruiz; empresa=Andes SAS");
    expect(ctx).toContain("horario_habil: SI");
    expect(ctx).toContain("traspaso_realizado: SI");
  });
});
