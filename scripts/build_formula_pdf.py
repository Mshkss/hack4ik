from pathlib import Path

from PIL import Image as PILImage
from PIL import ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    Image as RLImage,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs"
OUT_PATH = OUT_DIR / "formuly_aerolodki.pdf"
FORMULA_IMAGE_DIR = ROOT / "tmp" / "formula_pdf_assets"
FONT_PATH = Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf")
FORMULA_IMAGE_INDEX = 0


def register_fonts():
    if FONT_PATH.exists():
        pdfmetrics.registerFont(TTFont("DocFont", str(FONT_PATH)))
        return "DocFont", "Courier"
    return "Helvetica", "Courier"


DOC_FONT, FORMULA_FONT = register_fonts()


styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        name="TitleRu",
        parent=styles["Title"],
        fontName=DOC_FONT,
        fontSize=22,
        leading=27,
        alignment=TA_CENTER,
        spaceAfter=10,
    )
)
styles.add(
    ParagraphStyle(
        name="SubtitleRu",
        parent=styles["BodyText"],
        fontName=DOC_FONT,
        fontSize=11,
        leading=15,
        textColor=colors.HexColor("#4c5c58"),
        alignment=TA_CENTER,
        spaceAfter=16,
    )
)
styles.add(
    ParagraphStyle(
        name="H1Ru",
        parent=styles["Heading1"],
        fontName=DOC_FONT,
        fontSize=16,
        leading=20,
        spaceBefore=12,
        spaceAfter=8,
        textColor=colors.HexColor("#0d7772"),
    )
)
styles.add(
    ParagraphStyle(
        name="H2Ru",
        parent=styles["Heading2"],
        fontName=DOC_FONT,
        fontSize=13,
        leading=17,
        spaceBefore=8,
        spaceAfter=6,
        textColor=colors.HexColor("#16211f"),
    )
)
styles.add(
    ParagraphStyle(
        name="BodyRu",
        parent=styles["BodyText"],
        fontName=DOC_FONT,
        fontSize=10,
        leading=14,
        spaceAfter=6,
    )
)
styles.add(
    ParagraphStyle(
        name="SmallRu",
        parent=styles["BodyText"],
        fontName=DOC_FONT,
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#4f5c58"),
    )
)


FORMULA_STYLE = ParagraphStyle(
    name="FormulaBox",
    parent=styles["Code"],
    fontName=FORMULA_FONT,
    fontSize=9,
    leading=12,
    leftIndent=0,
    rightIndent=0,
    spaceBefore=4,
    spaceAfter=8,
    backColor=colors.HexColor("#f4f7f6"),
    borderColor=colors.HexColor("#d9e2df"),
    borderPadding=6,
    borderWidth=0.5,
)


def p(text, style="BodyRu"):
    return Paragraph(text, styles[style])


def formula_font(size=30):
    if FONT_PATH.exists():
        return ImageFont.truetype(str(FONT_PATH), size)
    return ImageFont.load_default()


def wrap_formula_line(draw, font, line, max_width):
    if not line:
        return [""]
    indent = line[: len(line) - len(line.lstrip())]
    words = line.lstrip().split(" ")
    wrapped = []
    current = indent
    for word in words:
        spacer = "" if current == indent else " "
        candidate = f"{current}{spacer}{word}"
        width = draw.textbbox((0, 0), candidate, font=font)[2]
        if width <= max_width or current == indent:
            current = candidate
        else:
            wrapped.append(current)
            current = f"{indent}  {word}"
    wrapped.append(current)
    return wrapped


def formula(text):
    global FORMULA_IMAGE_INDEX
    FORMULA_IMAGE_INDEX += 1
    FORMULA_IMAGE_DIR.mkdir(parents=True, exist_ok=True)

    font = formula_font()
    pad_x = 28
    pad_y = 22
    max_text_width = 1120
    scratch = PILImage.new("RGB", (10, 10), "white")
    draw = ImageDraw.Draw(scratch)
    lines = []
    for raw_line in text.strip().splitlines():
        lines.extend(wrap_formula_line(draw, font, raw_line.rstrip(), max_text_width))

    bbox = draw.textbbox((0, 0), "Mg", font=font)
    line_height = max(38, bbox[3] - bbox[1] + 12)
    width = max_text_width + pad_x * 2
    height = pad_y * 2 + line_height * max(1, len(lines))
    image = PILImage.new("RGB", (width, height), "#f4f7f6")
    draw = ImageDraw.Draw(image)
    draw.rectangle([0, 0, width - 1, height - 1], outline="#d9e2df", width=2)
    y = pad_y
    for line in lines:
        draw.text((pad_x, y), line, fill="#16211f", font=font)
        y += line_height

    image_path = FORMULA_IMAGE_DIR / f"formula_{FORMULA_IMAGE_INDEX:02d}.png"
    image.save(image_path)
    flowable = RLImage(str(image_path))
    flowable.drawWidth = 170 * mm
    flowable.drawHeight = flowable.drawWidth * height / width
    flowable.hAlign = "LEFT"
    return flowable


def bullets(items):
    return ListFlowable(
        [ListItem(p(item), leftIndent=8) for item in items],
        bulletType="bullet",
        start="circle",
        leftIndent=14,
    )


def var_table(rows):
    data = [[p("<b>Обозначение</b>"), p("<b>Смысл</b>"), p("<b>Единицы</b>")]]
    data.extend([[p(a), p(b), p(c)] for a, b, c in rows])
    table = Table(data, colWidths=[33 * mm, 106 * mm, 30 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e9f2f0")),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d9e2df")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def formula_block(title, formula_text, explanation, details=None):
    content = [p(title, "H2Ru"), formula(formula_text), p(explanation)]
    if details:
        content.append(bullets(details))
    return KeepTogether(content + [Spacer(1, 4)])


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont(DOC_FONT, 8)
    canvas.setFillColor(colors.HexColor("#66736f"))
    canvas.drawString(18 * mm, 10 * mm, "Цифровой штурман аэролодки: формулы расчетной модели")
    canvas.drawRightString(192 * mm, 10 * mm, str(doc.page))
    canvas.restoreState()


def build_story():
    story = [
        p("Формулы расчетной модели аэролодки", "TitleRu"),
        p(
            "Документ объясняет, как веб-приложение считает скорость, режим глиссирования, "
            "мощность, расход топлива, риск и итоговую стоимость ребра графа.",
            "SubtitleRu",
        ),
        p("1. Общая идея модели", "H1Ru"),
        p(
            "Маршрут состоит из коротких участков графа. Для каждого участка известны длина, "
            "тип поверхности, риск и источник ребра: широкий navmesh, узкая линия waterway или "
            "привязка пользовательской точки. Дальше C++-движок подбирает рекомендованную скорость, "
            "определяет режим движения и считает стоимость участка."
        ),
        bullets(
            [
                "Скорость зависит от выбранного режима маршрута: быстрый, экономичный, кратчайший или безопасный.",
                "Глиссирование определяется через число Froude и минимальный порог скорости.",
                "Топливо считается через сопротивление, требуемую мощность и удельный расход двигателя.",
                "Риск увеличивается на быстрых и узких участках.",
                "Алгоритм A* выбирает путь с минимальной суммарной стоимостью.",
            ]
        ),
        p("2. Основные переменные", "H1Ru"),
        var_table(
            [
                ("d_seg", "длина участка графа", "км"),
                ("V_rec", "рекомендованная скорость на участке", "км/ч"),
                ("v", "та же скорость в метрах в секунду", "м/с"),
                ("m_dry", "сухая масса аэролодки", "кг"),
                ("m_payload", "полезная загрузка", "кг"),
                ("m", "полная масса", "кг"),
                ("L", "расчетная длина корпуса", "м"),
                ("Fn", "число Froude", "безразмерно"),
                ("R", "оценка сопротивления движению", "Н"),
                ("P", "требуемая мощность", "кВт"),
                ("BSFC", "удельный расход топлива двигателя", "г/кВт·ч"),
                ("rho_fuel", "плотность топлива", "кг/л"),
                ("k_surf", "коэффициент поверхности", "безразмерно"),
                ("k_mode", "коэффициент выбранного режима", "безразмерно"),
            ]
        ),
        p("3. Формулы по шагам", "H1Ru"),
    ]

    blocks = [
        (
            "Шаг 1. Полная масса",
            r"""
m = max(200, m_dry + m_payload)

m_eff = m · k_load
""",
            "Масса нужна для сопротивления поверхности. Чем тяжелее лодка, тем больше сила, которую нужно преодолеть при движении по воде, льду, шуге или камышу.",
            [
                "m_dry задается в настройках как масса лодки.",
                "m_payload задается как загрузка: люди, груз, топливо, оборудование.",
                "k_load приходит из конфигурации: например, режим с поддувом может иметь другой коэффициент нагрузки.",
            ],
        ),
        (
            "Шаг 2. Перевод скорости и время участка",
            r"""
v = V_rec / 3.6

t_seg = d_seg / V_rec
""",
            "Время участка считается в часах. Если участок 1 км, а рекомендованная скорость 40 км/ч, время будет 1/40 часа, то есть 1.5 минуты.",
            [
                "V_rec выбирается движком: на широких безопасных участках выше, на узких и рисковых ниже.",
                "Для формулы сопротивления нужна скорость в м/с, поэтому используется деление на 3.6.",
            ],
        ),
        (
            "Шаг 3. Число Froude",
            r"""
Fn = v / √(g · L)
""",
            "Число Froude показывает отношение скорости лодки к характерной волновой скорости корпуса. Это удобный критерий перехода от водоизмещающего режима к глиссированию.",
            [
                "g = 9.80665 м/с^2.",
                "L — расчетная длина корпуса.",
                "Чем больше Fn, тем ближе лодка к режиму выхода на глиссирование.",
            ],
        ),
        (
            "Шаг 4. Порог устойчивого глиссирования",
            r"""
m_ref = max(m_dry + 500, 1)

V_planing = max(
    V_min,
    3.6 · Fn_full · √(g · L) · √(m / m_ref)
)
""",
            "Порог глиссирования растет с массой. Тяжелая лодка требует большей скорости, чтобы выйти на устойчивое скольжение.",
            [
                "V_min — минимальная скорость глиссирования из настроек.",
                "Fn_full — Froude-порог уверенного глиссирования.",
                "m_ref — базовая расчетная масса, относительно которой оценивается влияние загрузки.",
            ],
        ),
        (
            "Шаг 5. Выбор режима движения",
            r"""
motion =
  planing,       если surface.planing = true, участок не узкий,
                 V_rec ≥ V_planing, Fn ≥ Fn_full, surface_risk ≤ 3

  transition,    если surface.planing = true,
                 V_rec ≥ 0.72 · V_planing, Fn ≥ Fn_on,
                 surface_risk ≤ 3

  displacement,  иначе
""",
            "На каждом участке движок помечает режим движения: глиссирование, переходный режим или водоизмещающий режим.",
            [
                "На узких waterway-участках глиссирование не считается безопасным.",
                "Сложные поверхности автоматически ведут к осторожному режиму.",
                "Переходный режим нежелателен для долгого движения: он может быть неэффективным по расходу.",
            ],
        ),
        (
            "Шаг 6. Коэффициент сопротивления корпуса",
            r"""
Cd = Cd_planing
    если motion = planing

Cd = (Cd_displacement + Cd_planing) / 2
    если motion = transition

Cd = Cd_displacement
    если motion = displacement
""",
            "В глиссировании сопротивление корпуса ниже, в водоизмещающем режиме выше, а переходный режим находится между ними.",
            [
                "Cd — не паспортная константа. Ее нужно калибровать по реальным трекам.",
                "В интерфейсе сейчас можно менять базовые параметры глиссирования, а Cd оставлен в модели как инженерное допущение.",
            ],
        ),
        (
            "Шаг 7. Горб сопротивления",
            r"""
k_hump = 0.72
    если motion = planing

k_hump = 1.18
    если motion = transition

k_hump = 1 + 0.42 · (Fn / max(Fn_on, 0.1))^4
    если motion = displacement
""",
            "Перед выходом на глиссирование лодка может попадать в неэффективную зону: скорость уже высокая, но корпус еще не скользит устойчиво. Это называется горбом сопротивления.",
            [
                "Переходный режим получает повышающий множитель.",
                "Устойчивое глиссирование снижает множитель, потому что часть корпуса выходит из воды или среды.",
            ],
        ),
        (
            "Шаг 8. Сопротивление участка",
            r"""
R_dyn = 0.5 · rho_air · A_res · Cd · v^2

R_air = 0.5 · rho_air · A_air · 0.9 · v^2

R_surf = m_eff · g · mu_surface · max(0.55, k_surf)

R = (R_dyn · k_hump + R_air + R_surf) · max(0.65, k_surf)
""",
            "Это прикладная оценка силы, которую должен преодолеть двигатель. В ней есть динамическая часть, воздушное сопротивление и сопротивление поверхности.",
            [
                "k_surf усиливает сопротивление для шуги, камыша, болота, камней и других сложных сред.",
                "mu_surface задает базовое трение/сопротивление поверхности.",
                "Формула не является CFD-моделью, но дает правильные зависимости: больше скорость, масса и сопротивление — больше требуемая мощность.",
            ],
        ),
        (
            "Шаг 9. Требуемая мощность",
            r"""
P_raw = R · v / (1000 · eta)

P = clamp(P_raw, P_min, P_max)
""",
            "Мощность равна силе сопротивления, умноженной на скорость. Деление на КПД тяги учитывает потери винта и трансмиссии.",
            [
                "eta — КПД тяги, настраивается в интерфейсе.",
                "P_max ограничен мощностью двигателя.",
                "P_min защищает модель от нулевого расхода на очень коротких и медленных участках.",
            ],
        ),
        (
            "Шаг 10. Расход топлива",
            r"""
q_fuel = P · BSFC · k_mode / (rho_fuel · 1000)

F_raw = q_fuel · t_seg

F_fallback = d_seg · base_l_per_km · k_surf · k_load · k_mode

F_seg = max(F_raw, 0.08 · F_fallback)
""",
            "BSFC переводит мощность двигателя в расход топлива. На выходе получается литров в час, затем литры на участок.",
            [
                "BSFC задается в г/кВт·ч.",
                "rho_fuel задается в кг/л.",
                "k_mode учитывает, что быстрый режим может быть прожорливее экономичного.",
                "Fallback нужен только как нижняя страховка для численной стабильности.",
            ],
        ),
        (
            "Шаг 11. Риск участка",
            r"""
k_speed = 1 + 0.22 · (V_rec / max(V_surface, 1))^2

k_narrow = 1.12 для узкого waterway, иначе 1.00

Risk_seg = d_seg · r_surface · k_speed · k_narrow
""",
            "Риск растет от опасной поверхности, скорости и узости русла. Поэтому безопасный режим может предпочесть более длинный, но менее рисковый путь.",
            [
                "r_surface приходит из карты поверхностей.",
                "Узким считается участок, построенный по OSM waterway или малому водоему.",
                "Скорость увеличивает риск квадратично, но умеренно.",
            ],
        ),
        (
            "Шаг 12. Стоимость ребра для A*",
            r"""
C_edge =
    w_d · d_seg
  + w_t · (t_seg · 60 / 10)
  + w_f · (F_seg / 10)
  + w_r · (Risk_seg / 5)
  + w_p · P_no_planing
  + w_h · H_hard
""",
            "A* ищет путь с минимальной суммой C_edge. Разные режимы маршрута отличаются весами w.",
            [
                "Быстрый режим повышает вес времени.",
                "Экономичный режим повышает вес топлива.",
                "Безопасный режим повышает вес риска.",
                "Кратчайший режим повышает вес расстояния.",
            ],
        ),
        (
            "Шаг 13. Штрафы за потерю глиссирования и сложные поверхности",
            r"""
P_no_planing = 0
    если surface.planing = true

P_no_planing = d_seg
    если surface.planing = false

H_hard = d_seg для hard-поверхности, иначе 0
""",
            "Эти штрафы помогают алгоритму избегать участков, где аэролодка идет неэффективно или опасно.",
            [
                "Если конфигурация запрещает сложные поверхности, такие ребра вообще исключаются из графа.",
                "Если сложные поверхности разрешены, они остаются в графе, но получают высокий штраф.",
            ],
        ),
        (
            "Шаг 14. Итоги маршрута",
            r"""
D = Σ d_seg

T = Σ t_seg

F = Σ F_seg

Risk = Σ Risk_seg

Fuel_remain = Fuel_tank - F

Fuel_reserve = Fuel_tank · reserve_frac
""",
            "После выбора маршрута движок суммирует длину, время, топливо и риск, а затем проверяет остаток топлива относительно резерва.",
            [
                "Если остаток ниже резерва, карточка расчета показывает предупреждение.",
                "Резерв задается пользователем в процентах от бака.",
            ],
        ),
    ]

    for title, formula_text, explanation, details in blocks:
        story.append(formula_block(title, formula_text, explanation, details))

    story.extend(
        [
            PageBreak(),
            p("4. Как читать пример из интерфейса", "H1Ru"),
            p(
                "Для базового маршрута Дивногорск → Красноярск карточка показывает по первому участку примерно такие значения:"
            ),
            var_table(
                [
                    ("V_rec", "44 км/ч", "рекомендованная скорость"),
                    ("Fn", "1.47", "выше порога глиссирования"),
                    ("R", "около 1846 Н", "оценка сопротивления"),
                    ("P", "около 38 кВт", "требуемая мощность"),
                    ("q_fuel", "около 16.7 л/ч", "мгновенный расход"),
                    ("F_seg", "около 0.4 л", "топливо первого участка"),
                ]
            ),
            p(
                "Если увеличить загрузку до 1400 кг, интерфейс пересчитывает массу до 2850 кг. "
                "На том же участке мощность растет примерно до 52 кВт, расход — до 22.3 л/ч, "
                "а итоговый расход маршрута — до 19.8 л. Это показывает, что параметры лодки "
                "теперь реально влияют на расчет, а не просто отображаются в форме."
            ),
            p("5. Что можно настраивать", "H1Ru"),
            bullets(
                [
                    "Масса лодки и загрузка: влияют на сопротивление и порог глиссирования.",
                    "Бак и резерв: влияют на проверку достаточности топлива.",
                    "Длина корпуса: влияет на число Froude.",
                    "Мощность двигателя: ограничивает доступную мощность.",
                    "КПД тяги: чем ниже КПД, тем больше мощность двигателя нужна для той же скорости.",
                    "BSFC: связывает мощность и расход топлива.",
                    "Fn-пороги и минимальная скорость: задают условия перехода в глиссирование.",
                    "mu_surface: базовое сопротивление поверхности.",
                ]
            ),
            p("6. Важное ограничение", "H1Ru"),
            p(
                "Эта модель не является точной паспортной моделью Raptor 650 и не заменяет испытания. "
                "Она нужна для MVP и защиты кейса: показать правильную структуру расчета и зависимость "
                "маршрута от физики лодки. Для продукта коэффициенты нужно калибровать по реальным трекам, "
                "замерам топлива, скорости, загрузки и состояния поверхности."
            ),
        ]
    )
    return story


def main():
    global FORMULA_IMAGE_INDEX
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    FORMULA_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    FORMULA_IMAGE_INDEX = 0
    for old_image in FORMULA_IMAGE_DIR.glob("formula_*.png"):
        old_image.unlink()
    doc = SimpleDocTemplate(
        str(OUT_PATH),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=16 * mm,
        title="Формулы расчетной модели аэролодки",
        author="Codex",
    )
    doc.build(build_story(), onFirstPage=footer, onLaterPages=footer)
    print(OUT_PATH)


if __name__ == "__main__":
    main()
