import * as maplibregl from "./vendor/maplibre-gl.mjs";
(async function () {
// GitHub Pages no manda cabeceras: si alguien mete la web en un marco de otro sitio (clickjacking), se sale de él
if (window.top !== window.self) window.top.location = window.location;
// ---- konfigurazioa: umbrales, escalas de color, coordenadas y URL externas de la web ----
// (lo que depende de los datos —categorías, colores de partido, nombres— llega en data/index.json desde
// scripts/web_konfig.py; aquí solo lo propio de la página)

// niveles del mapa en automático: [nivel, zoom desde, zoom hasta]. "eh" = todo el ámbito en un polígono; "eremua" = la CAV,
// Nafarroa e Iparralde, antes de los herrialdes
const AUTO = [["eh", 0, 7.8], ["eremua", 7.8, 8.5], ["territorio", 8.5, 9.2], ["eskualdea", 9.2, 10], ["muni", 10, 11.75], ["sec", 11.75, 24]];
const LUR_MUGA_ZOOM = 8.5;  // desde aquí, los límites de los herrialdes (dorados) siempre encima
const MODOS = ["winner", "margin", "turnout", "compare", "udalforal"];
// Escalas y colores del mapa (límite superior de cada tramo → color), en las dos paletas.
// Lo que manda aquí no es el tema de la interfaz sino el fondo sobre el que se dibuja:
//   · satélite encendido → imagen de tono medio-oscuro, sirve la paleta oscura (en los dos temas)
//   · satélite apagado + tema oscuro → pizarra, paleta oscura
//   · satélite apagado + tema claro  → papel, paleta clara: cada escala se oscurece un paso,
//     porque su extremo pálido (p. ej. #F5E9D6) no se distinguiría del fondo claro, y la línea
//     de las comarcas pasa de casi blanca a pizarra. Los colores de partido y bloque NO cambian:
//     son identidad y vienen de data/index.json.
// Paleta efectiva en MAPA_K; paletaEzarri() (06-menu-erradiala.js) la cambia y repinta.
const PALETAK = {
  ilun: {
    margin: [[2, "#7A1F1F"], [5, "#B8452E"], [10, "#E08A4D"], [20, "#EFC48F"], [Infinity, "#F5E9D6"]],
    turnout: [[50, "#E4EEF5"], [58, "#B6CFE3"], [66, "#7FA6CB"], [74, "#4A7BAA"], [Infinity, "#22507D"]],
    uf: [[2, "#E8F1EF"], [4, "#AFD5CD"], [6, "#6FB3A7"], [8, "#338C80"], [Infinity, "#0F6358"]],
    nodata: "#2A3946", uncontested: "#5F7686",
    change: { same: "#4A5C6A", flip: "#F2B544", "new": "#4A7BAA" },
    zona: { Hegoalde: "#6FA39A", Iparralde: "#A98BC4", "Euskal Herria": "#F2B544", Azkenak: "#F2B544" },
    fondoa: "#0C131A", muga: "#0A1016", mugaEsk: "#D6E1E8", mugaLur: "#F2B544",
    nabarmen: "#F6C866", marra: "rgba(214,225,232,.55)",
  },
  argi: {
    margin: [[2, "#6B1414"], [5, "#9E3620"], [10, "#CE6B33"], [20, "#E2A86B"], [Infinity, "#EFD3AC"]],
    turnout: [[50, "#CFE0EC"], [58, "#9CBDD8"], [66, "#6690BC"], [74, "#36689B"], [Infinity, "#1A4269"]],
    uf: [[2, "#D4E7E3"], [4, "#97C8BF"], [6, "#55A295"], [8, "#1D7C70"], [Infinity, "#0A5349"]],
    nodata: "#C2CED7", uncontested: "#93A5B2",
    change: { same: "#93A5B2", flip: "#A97608", "new": "#36689B" },
    zona: { Hegoalde: "#3F7A70", Iparralde: "#7A5B9B", "Euskal Herria": "#8A5F05", Azkenak: "#8A5F05" },
    fondoa: "#E8EDF1", muga: "#55707F", mugaEsk: "#37506A", mugaLur: "#A97608",
    nabarmen: "#7A5200", marra: "rgba(30,50,66,.55)",
  },
};
let MAPA_K = PALETAK.ilun;
let MARGIN_BINS = MAPA_K.margin, TURNOUT_BINS = MAPA_K.turnout, UF_BINS = MAPA_K.uf;
let NODATA = MAPA_K.nodata, UNCONTESTED = MAPA_K.uncontested;
let CHANGE = MAPA_K.change, ZONA_COLOR = MAPA_K.zona;
// mapa: vista inicial, encuadre de Euskal Herria, límites de zoom y satélite
const MAPA = { erdia: [-2.2, 42.9], zooma: 7.4, minZoom: 6, maxZoom: 16, ehMugak: [[-3.45, 41.9], [-0.7, 43.6]] };
// Imagen de fondo, gratuita y sin clave: Sentinel-2 sin nubes (EOX, 10 m) para todo el mapa y, al acercar,
// ortofotos (PNOA 25-50 cm en Hegoalde, BD ORTHO 20 cm en Iparralde), cada una recortada a su territorio
// con geo/maskarak.json porque fuera de su país devuelven relleno opaco (blanco o pixelado).
const IRUDIAK = {
  sentinel: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg",
  sentinelMaxZoom: 13,  // EOX no sirve más detalle: a partir de ahí se amplía la última tesela
  pnoa: "https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&VERSION=1.0.0&Layer=OI.OrthoimageCoverage&Style=default&Format=image/jpeg&TileMatrixSet=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}",
  bdortho: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg",
  ortoMinZoom: 10,      // desde el nivel de municipios
};
// Créditos del mapa (botón ⓘ): los de las imágenes, que sus licencias piden junto al mapa; los de los datos, en Iturriak
const ATRIB = () => `${T.irudiak}: <a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless 2024</a> (EOX, Copernicus, CC BY-NC-SA) · PNOA © IGN España (CC BY) · BD ORTHO © IGN France · <a href="${HIZK === "eu" ? "iturriak.html" : `iturriak.${HIZK}.html`}">${T.datuak}: ${T.iturriak}</a>`;  // T: 00-testuak.js
// Comunidad Autónoma del País Vasco (diferencia udal / foru, solo allí)
// menú radial: letra de cada tipo de convocatoria en el anillo y geometría (px del SVG)
const LETRA = { generales: "O", legislativas: "L", presidenciales: "P", regionales: "E", departamentales: "D" };
const CX = 250, CY = 250, R_HUB = 46, R_K0 = 50, R_K1 = 118, R_I0 = 124, R_I1 = 236;
const SVGNS = "http://www.w3.org/2000/svg";
// Sala de situación: aviso al cambiar de nivel con el zoom, teclas de modo y minimapa
const TEKLA_MODUAK = { w: "winner", m: "margin", t: "turnout", c: "compare", u: "udalforal" };
// Argibidea (puntero): solo los partidos o bloques a esta distancia (puntos) del primero, los que optan a gobernar
const LEHIA_MARJINA = 10;
const TOAST_MS = 1600, PLAY_HILABETEA_MS = 120;  // reproducir la línea de tiempo: milisegundos por mes
// Hemiciclo: orden de los escaños de izquierda a derecha, por bloque
// Euskal Parlamentu Federala (simulazioa): eserlekuak herrialde bakoitzeko, "Autonomikoak" hauteskundeetan oinarrituta
const FEDERALA = { eserlekuak: { Zuberoa: 10, "Behe Nafarroa": 15, Araba: 25, Lapurdi: 25, Gipuzkoa: 40, Nafarroa: 45, Bizkaia: 60 },
  langa: .03, kanpokoa: "#22303B" };  // langa: herrialde bakoitzeko hautagaitzen botoen %; kanpokoa: koaliziotik kanpoko eserlekuak
const HEMIZIKLO_ORDENA = ["Ezker estatala", "EH Bai + Ezkerrak", "Ezker subiranista", "Alderdi Sozialista", "EAJ", "Zentroa", "Eskuina", "Ultra eskuina", "LOCAL"];
// Los textos de la interfaz (en cuatro idiomas) están en 00-testuak.js
// ---- testuak: textos de la interfaz en cuatro idiomas (euskera el principal) ----
// Idioma: el del enlace (#l=es), si no el último elegido en este navegador, si no euskera. Lo que falte en un
// idioma sale en euskera. Los topónimos (Bilbo, Iruñea, Baiona…) y los nombres de partido no se traducen.
const HIZKUNTZAK = { eu: "Euskara", es: "Español", fr: "Français", en: "English" };
const HIZK = (() => {
  const l = new URLSearchParams(location.hash.slice(1)).get("l");
  if (l in HIZKUNTZAK) { try { localStorage.setItem("behatokia-hizkuntza", l); } catch { /* sin almacenamiento */ } return l; }
  try { const g = localStorage.getItem("behatokia-hizkuntza"); if (g in HIZKUNTZAK) return g; } catch { /* sin almacenamiento */ }
  return "eu";
})();
// Formato de números y fechas de cada idioma (el euskera, como el castellano de aquí: 1.234,5)
const LOKALEA = { eu: "es-ES", es: "es-ES", fr: "fr-FR", en: "en-GB" }[HIZK];

const TESTUAK = {
  eu: {
    erakundeak: {},
    // nombres que dependen de los datos
    kat: { udal: "Udalak", autonomikoak: "Autonomikoak", foralak: "Foralak", estatu: "Estatua", europa: "Europa" },
    mota: { municipales: "Udalak", generales: "Orokorrak", legislativas: "Legegileak", presidenciales: "Presidentetza",
      regionales: "Erregionalak", departamentales: "Eskualdekoak", europeas: "Europa", autonomicas: "Autonomikoak",
      "autonomicas|EAE": "Legebiltzarra", "autonomicas|Nafarroa": "Nafarroako Parlamentua", forales: "Batzar Nagusiak" },
    motaLuzea: { municipales: "Udal hauteskundeak", generales: "Hauteskunde orokorrak (Espainia)", legislativas: "Hauteskunde legegileak (Frantzia)",
      presidenciales: "Presidentetzarako hauteskundeak (Frantzia)", regionales: "Erregio hauteskundeak (Akitania Berria)",
      departamentales: "Eskualdeko hauteskundeak (kantonamenduka)", autonomicas: "Autonomia-hauteskundeak", forales: "Batzar Nagusietako hauteskundeak",
      europeas: "Europar hauteskundeak", azkenak: "Azken hauteskundeak" },
    mailak: { eh: "Euskal Herria", eremua: "EAE · Nafarroa Garaia · Iparralde", territorio: "Herrialdeak", eskualdea: "Eskualdeak", barruti_elektorala: "Barrutiak (Batzar Nagusiak)",
      partido_judicial: "Barruti judizialak", zona_linguistica: "Hizkuntza-eremuak (Nafarroa)", legegile_barrutia: "Legegileen barrutiak (Iparraldea)", euskara_eremua: "Euskara-eremuak (ezagutza)",
      kantonamendua: "Kantonamenduak (Iparraldea)", muni: "Udalerriak", sec: "Sekzio zentsalak" },
    blokeak: { "Ezker subiranista": "Ezker subiranistak", "EAJ": "EAJ-Geroa Bai", "Alderdi Sozialista": "Alderdi Sozialistak",
      "Ezker estatala": "Ezker estatalak" },  // el resto, el nombre del bloque tal cual
    zonak: { Azkenak: "Azkenak", "Euskal Herria": "Euskal Herria", Hegoalde: "Hegoalde", Iparralde: "Iparralde" },
    zonaLabur: { EAE: "EAE", Nafarroa: "Naf.", Hegoalde: "Heg.", Iparralde: "Ipa.", "Euskal Herria": "EH" },
    // página
    menua: "Menua", atalak: "Atalak", mapa: "Mapa", metodologia: "Metodologia", iturriak: "Iturriak", guriBuruz: "Guri buruz", legeOharra: "Lege oharra", irudiak: "Irudiak", datuak: "Datuak",
    hizkuntza: "Hizkuntza", kokapena: "Kokapena", lasterbideakIzenb: "Teklatuko lasterbideak (?)", hauteskundea: "Hauteskundea",
    satelitea: "Satelitea", sateliteaIzenb: "Satelite-mapa erakutsi / ezkutatu (S)", mapaAria: "Euskal Herriko mapa",
    argiaAria: "Itxura argira aldatu", ilunaAria: "Itxura ilunera aldatu", temaAria: "Itxura argia / iluna", temaIzenb: "Itxura argia / iluna (I)",
    tresnakIzenb: "Tresnak ezkutatu / erakutsi (L)", bilatu: "Bilatu", udalerriaPh: "Udalerria…", bilatuUdalerria: "Bilatu udalerria",
    mapaModua: "Mapa modua", irabazlea: "Irabazlea", lehianEremuak: "Lehian dauden eremuak", konparatuBiUrte: "Konparatu bi urte",
    udalForu: "Udal / foru aldea", ufselAria: "Udal / foru aldea: alderdia", eremua: "Eremua", automatikoa: "Automatikoa (zoomaren arabera)",
    panela: "Panela", emaitzak: "Emaitzak", denboraLerroa: "Denbora-lerroa", azkenHauteskundeak: "Azken hauteskundeak",
    lasterbideak: "Lasterbideak", itxi: "Itxi", kargatzen: "Kargatzen…", errorea: "Errorea",
    lagMota: "Mapa mota: Udalak, Autonomikoak, Foralak, Estatua, Europa", lagQE: "Aurreko / hurrengo hauteskundea",
    lagWMT: "Irabazlea, lehian dauden eremuak, parte-hartzea", lagCU: "Konparatu bi urte, udal / foru aldea", lagItxura: "Itxura argia / iluna", lagS: "Satelite-mapa erakutsi / ezkutatu",
    lagL: "Ezkerreko menua erakutsi / ezkutatu", lagK: "Emaitzak ↔ eserlekuak (panelean)", lagP: "Denbora-lerroa erreproduzitu / gelditu",
    lagBilatu: "Udalerri bat bilatu", lag0: "Euskal Herria osoa ikusi", lagEsc: "Hautapena eta leihoak itxi",
    // panel
    udalerri: "udalerri", biztLabur: "bizt.", biztanle: "biztanle", zinegotzi: "zinegotzi", eserleku: "eserleku", sekzioa: "sekzioa",
    botoakBlokeka: "Botoak blokeka", botoakAlderdika: "Botoak alderdika", irabazitakoUdalerriak: "Irabazitako udalerriak", mapakoKoloreak: "mapako koloreak",
    koloreaIrabazlea: "Kolorea: eremu bakoitzeko irabazlea.", grisez: "grisez", puntu: "puntu", irabazleAldaketa: "Irabazlearen aldaketa",
    daturikEzHemen: "Daturik ez:", vs: "vs", hauteskundeN: "hauteskunde", maila: "Maila",
    partehartzea: "parte-hartzea", errolda: "errolda", bozkatzaileak: "boto-emaileak", hautagaitzenBotoak: "hautagaitzen boto",
    aldeaGuztira: "aldea guztira", parteUdal: "parte-h. udal.", parteForu: "parte-h. foru.", aldea12: "aldea 1.–2.", zerrendaIrekiak: "Zerrenda irekiak",
    udalLabur: "Udal.", foruLabur: "Foru.",
    ufAzalpenaEz: "Udal hauteskundeak foru-pareko hauteskundeekin konparatzen dira: EAEn Batzar Nagusiak eta Nafarroan Parlamentua (egun berean), Iparraldean kantonalak (hurbilenak). Aukeratu udal hauteskunde bat, Batzar Nagusiak, Nafarroako Parlamentua, kantonalak edo «Azkenak» Udalak / Foralak mapetan.",
    ufIzenburua: "Udal / foru aldea", partehartzeaIzenb: "Parte-hartzea", egoiliarPartehartzea: "Egoiliarren parte-hartzea", lehian: "Lehian", marjinaLegenda: "Lehenengo eta bigarrenaren arteko aldea",
    irabazleaAldatu: "Irabazlea aldatu da", irabazleBera: "Irabazle bera", hautagaitza: "Hautagaitza", hautagaitzaBakarra: "Hautagaitza bakarra",
    alderdia: "Alderdia", ufDaturikEz: "Daturik ez · udal / foru aldea", ufDaturikEzTip: "Daturik ez udal / foru aldea kalkulatzeko",
    aggOharra: "Botoak familiaka batuta; tokiko zerrendak ez dira irabazle-kalkuluan sartzen.",
    ceraLbl: "Atzerriko botoa (CERA)", egoiliarrak: "egoiliarrak", ceraBarne: "Goiko emaitzetan batuta dago (lurraldeetan eta guztira). Mapako parte-hartzearen geruzak ez du barne hartzen (egoiliarrak).",
    ufAzalpena: "Alderdi edo bloke berak udal hauteskundeetan eta foru-parekoetan jasotako botoen aldea: EAEn Batzar Nagusiak eta Nafarroan Parlamentua (egun berean), Iparraldean kantonal hurbilenak. «Guztira»: aldeen batura erdia, hau da, bozkatzaileen zein zatik bozkatu duen bestela.",
    botoAldaketaOsoa: "boto aldaketa osoa", guztiraAukera: "Guztira (boto aldaketa osoa)",
    ikuspegiaAzalpena: "Hegoaldea alderdika; Euskal Herri osoa eta Iparraldea blokeka (Iparraldeko udal hauteskundeak izan ezik, zerrendaka).",
    konparatzekoa: "Konparatzeko hauteskundea", hauteskundeMotak: "Hauteskunde motak",
    hutsaKanpoan: "Hauteskunde hau ez da eremu honetan egin",
    hutsaKantoia: "Kantonamendu honek ez zuen bozkatu 2011ko eskualdekoetan: kantonamenduen erdia baino ez zen berritu",
    hutsaMuga: "Sekzio honek ez du emaitza propiorik hauteskunde honetan (sekzio-mugak aldatu ziren edo beste sekzio batekin batera bozkatu zuen). Ikusi udalerriaren datuak",
    hutsaIturririk: "Iturri ofizialean ez dago emaitzarik eremu honetarako (adibidez, zerrendarik aurkeztu ez zelako)",
    hutsaLegenda: "Marraduna: daturik ez (pasa sagua gainetik zergatia ikusteko)",
    sekzioBatera: "Hauteskunde honetan sekzio hau beste honekin batera bozkatu zen (errolda itxi ondoren sortu zen):",
    hautagaiak: "Hautagaiak", kantonamenduOfizialak: "Kantonamendu ofizialak",
    kantonamenduAzalpena: "Baiona eta Angelu hainbat kantonamendutan banatuta daude: mapan Bokalerekin batera ageri dira, eta hemen kantonamendu bakoitzaren emaitza ofiziala, mahaiz mahai batuta.",
    tokikoak: "Tokiko zerrendak", gainontzekoak: "Gainontzekoak", daturikEz: "Daturik ez",
    tresnakEzkutatu: "Tresnak ezkutatu", tresnakErakutsi: "Tresnak erakutsi",
    // escaños
    panelaZabaldu: "Panela zabaldu / tolestu", 
    laburpenikEz: "Eremu honek ez du daturik hauteskunde honetan", botoak: "Botoak",
    ufEzin: "Ezin da konparatu: udal botoa ia osorik sailkatu gabeko zerrendetakoa da (alderdirik gabe)", ufForua: "foru-parekoa", bilakaera: "Bilakaera", bilakaeraHautatu: "Hautatu eremu bat mapan 2011tik nola bozkatu duen ikusteko.", bilCera: "Egoiliarren parte-hartzea; ehunekoak atzerriko botoarekin (CERA), iturriak ematen duenean.", bilOsatugabe: "Puntu hutsak: Euskal Herri osoa hartzen ez duten hauteskundeak (zatiren baten daturik ez dago data horretan); ez dira besteekin lotzen.", bilBakarrik: (z) => `${z} bakarrik`, bilakaeraGrafikoa: "Botoen bilakaera", partaidetza: "Parte-hartzea", zinegotziakLabur: "Zineg.", bozkenEhunekoa: "Botoen %", hauteskundez: "Hauteskundez hauteskunde",
    eserlekuak: "Eserlekuak", gehiengoa: "Gehiengo osoa", barrutika: "Barrutika", udala: "udala", herrialdeka: "Herrialdeka",
    zinegotziakEH: "Zinegotziak Euskal Herrian (blokeka)", zinegotziak: "Zinegotziak",
    eserlekurikEzHemen: "Hautatutako eremuak ez du eserlekurik erakunde hauetan (Iparraldean, bigarren itzulian erabakitzen dira).",
    zinegotziHautatu: "Hautatu udalerri bat bere udalaren osaera ikusteko.",
    zinegotzirikEz: "Lehen itzuliko fitxategian ez dago zinegotzien daturik (Iparraldean, bigarren itzulia behar izan zuten udalerriak, gehienbat)",
    zinegotzirikEzN: "udalerritan ez dago zinegotzien daturik lehen itzuliko fitxategian (Iparraldean, bigarren itzulia behar izan zutenak, gehienbat: Baiona, Miarritze…)",
    dhondtAzalpena: "Nafarroako Parlamentuko eserlekuak hemen kalkulatu dira, d'Hondt legearekin eta %3ko langarekin, mahaietako botoetatik; emaitza ofizialekin egiaztatuta.",
    eserlekuIparralde: "Iparraldean (legegileak, eskualdekoak, erregionalak, presidentzialak) bigarren itzulian erabakitzen dira eserlekuak; Behatokiak lehen itzulia bakarrik jasotzen du.",
    eserlekuEuropa: "Europako Parlamentuan Espainia eta Frantzia barruti bakarra dira: ez dago Euskal Herriko eserleku-banaketarik.",
    eserlekurikEz: "Hauteskunde honetarako ez dago eserleku-daturik.",
    fedIzena: "Euskal Parlamentu Federala", fedSimulazioa: "simulazioa", fedJolastu: "Egin zure gobernu koalizioa", fedKoalizioa: "Koalizioaren eserlekuak",
    fedTaldeak: "Parlamentu-taldeak", fedHasi: "Sakatu taldeak koalizioa osatzeko", fedLortuta: "Gehiengo osoa! Gobernua osatu duzu", fedFalta: "falta dira",
    fedGarbitu: "Hustu", fedTxikienak: "Koalizio irabazle txikienak",
    fedMetodoa: "Metodoa: herrialde bakoitzean d'Hondt legea, hautagaitzen botoen %3ko langarekin. Hegoaldean alderdika banatzen da eta Iparraldean blokeka; parlamentuan eserlekuak blokeka biltzen dira. Sailkatu gabeko tokiko zerrendak ez dira sartzen. Ez da benetako erakunde bat: ariketa bat da.",
    // línea de tiempo
    dataAukeratu: "Data: zona bakoitzean, data horretarainoko azken hauteskundeak", gaur: "Gaur", erreproduzitu: "Erreproduzitu", gelditu: "Gelditu",
  },
  es: {
    erakundeak: {"Eusko Legebiltzarra": "Parlamento Vasco", "Nafarroako Parlamentua": "Parlamento de Navarra", "Arabako Batzar Nagusiak": "Juntas Generales de Álava", "Bizkaiko Batzar Nagusiak": "Juntas Generales de Bizkaia", "Gipuzkoako Batzar Nagusiak": "Juntas Generales de Gipuzkoa", "Diputatuen Kongresua (Hegoaldea)": "Congreso de los Diputados (Hegoalde)"},
    kat: { udal: "Municipales", autonomikoak: "Autonómicas", foralak: "Forales", estatu: "Estatales", europa: "Europeas" },
    mota: { municipales: "Municipales", generales: "Generales", legislativas: "Legislativas", presidenciales: "Presidenciales",
      regionales: "Regionales", departamentales: "Departamentales", europeas: "Europeas", autonomicas: "Autonómicas",
      "autonomicas|EAE": "Parlamento Vasco", "autonomicas|Nafarroa": "Parlamento de Navarra", forales: "Juntas Generales" },
    motaLuzea: { municipales: "Elecciones municipales", generales: "Elecciones generales (España)", legislativas: "Elecciones legislativas (Francia)",
      presidenciales: "Elecciones presidenciales (Francia)", regionales: "Elecciones regionales (Nueva Aquitania)",
      departamentales: "Elecciones departamentales (por cantones)", autonomicas: "Elecciones autonómicas", forales: "Elecciones a Juntas Generales",
      europeas: "Elecciones europeas", azkenak: "Últimas elecciones" },
    mailak: { eh: "Euskal Herria", eremua: "CAV · Nafarroa Garaia · Iparralde", territorio: "Territorios", eskualdea: "Comarcas", barruti_elektorala: "Circunscripciones (Juntas Generales)",
      partido_judicial: "Partidos judiciales", zona_linguistica: "Zonas lingüísticas (Navarra)", legegile_barrutia: "Circunscripciones legislativas (Iparralde)", euskara_eremua: "Zonas por conocimiento del euskera",
      kantonamendua: "Cantones (Iparralde)", muni: "Municipios", sec: "Secciones censales" },
    blokeak: { "Ezker subiranista": "Izquierdas soberanistas", "EAJ": "EAJ-PNV-Geroa Bai", "Alderdi Sozialista": "Partidos socialistas", "Ezker estatala": "Izquierdas estatales",
      "EH Bai + Ezkerrak": "EH Bai + izquierdas", "Zentroa": "Centro", "Eskuina": "Derecha", "Ultra eskuina": "Extrema derecha" },
    zonak: { Azkenak: "Últimas", "Euskal Herria": "Euskal Herria", Hegoalde: "Hegoalde", Iparralde: "Iparralde" },
    zonaLabur: { EAE: "CAV", Nafarroa: "Naf.", Hegoalde: "Heg.", Iparralde: "Ipa.", "Euskal Herria": "EH" },
    menua: "Menú", atalak: "Secciones", mapa: "Mapa", metodologia: "Metodología", iturriak: "Fuentes", guriBuruz: "Quiénes somos", legeOharra: "Aviso legal", irudiak: "Imágenes", datuak: "Datos",
    hizkuntza: "Idioma", kokapena: "Ubicación", lasterbideakIzenb: "Atajos de teclado (?)", hauteskundea: "Elección",
    satelitea: "Satélite", sateliteaIzenb: "Mostrar / ocultar el mapa de satélite (S)", mapaAria: "Mapa de Euskal Herria",
    argiaAria: "Cambiar al aspecto claro", ilunaAria: "Cambiar al aspecto oscuro", temaAria: "Aspecto claro / oscuro", temaIzenb: "Aspecto claro / oscuro (I)",
    tresnakIzenb: "Ocultar / mostrar herramientas (L)", bilatu: "Buscar", udalerriaPh: "Municipio…", bilatuUdalerria: "Buscar municipio",
    mapaModua: "Capa del mapa", irabazlea: "Ganador", lehianEremuak: "Zonas reñidas", konparatuBiUrte: "Comparar dos años",
    udalForu: "Diferencia municipales / forales", ufselAria: "Diferencia municipales / forales: partido", eremua: "Ámbito", automatikoa: "Automático (según el zoom)",
    panela: "Panel", emaitzak: "Resultados", denboraLerroa: "Línea de tiempo", azkenHauteskundeak: "Últimas elecciones",
    lasterbideak: "Atajos", itxi: "Cerrar", kargatzen: "Cargando…", errorea: "Error",
    lagMota: "Tipo de mapa: municipales, autonómicas, forales, estatales, europeas", lagQE: "Elección anterior / siguiente",
    lagWMT: "Ganador, zonas reñidas, participación", lagCU: "Comparar dos años, diferencia municipales / forales", lagItxura: "Aspecto claro / oscuro", lagS: "Mostrar / ocultar el satélite",
    lagL: "Mostrar / ocultar el menú de la izquierda", lagK: "Resultados ↔ escaños (en el panel)", lagP: "Reproducir / parar la línea de tiempo",
    lagBilatu: "Buscar un municipio", lag0: "Ver Euskal Herria entera", lagEsc: "Cerrar la selección y las ventanas",
    udalerri: "municipios", biztLabur: "hab.", biztanle: "habitantes", zinegotzi: "concejales", eserleku: "escaños", sekzioa: "sección",
    botoakBlokeka: "Votos por bloques", botoakAlderdika: "Votos por partidos", irabazitakoUdalerriak: "Municipios ganados", mapakoKoloreak: "colores del mapa",
    koloreaIrabazlea: "Color: ganador de cada zona.", grisez: "en gris", puntu: "puntos", irabazleAldaketa: "Cambio de ganador",
    daturikEzHemen: "Sin datos:", vs: "vs", hauteskundeN: "elecciones", maila: "Nivel",
    partehartzea: "participación", errolda: "censo", bozkatzaileak: "votantes", hautagaitzenBotoak: "votos a candidaturas",
    aldeaGuztira: "diferencia total", parteUdal: "particip. munic.", parteForu: "particip. forales", aldea12: "diferencia 1.º–2.º", zerrendaIrekiak: "Listas abiertas",
    udalLabur: "Mun.", foruLabur: "For.",
    ufAzalpenaEz: "Las municipales se comparan con su equivalente foral: Juntas Generales en la CAV y Parlamento en Navarra (el mismo día), cantonales en Iparralde (las más cercanas). Elige unas municipales, unas Juntas Generales, el Parlamento de Navarra, unas cantonales o «Últimas» en los mapas Municipales / Forales.",
    ufIzenburua: "Diferencia municipales / forales", partehartzeaIzenb: "Participación", egoiliarPartehartzea: "Participación de residentes", lehian: "Reñido", marjinaLegenda: "Diferencia entre el primero y el segundo",
    irabazleaAldatu: "Ha cambiado el ganador", irabazleBera: "Mismo ganador", hautagaitza: "Candidatura", hautagaitzaBakarra: "Candidatura única",
    alderdia: "Partido", ufDaturikEz: "Sin datos · diferencia municipales / forales", ufDaturikEzTip: "Sin datos para calcular la diferencia municipales / forales",
    aggOharra: "Votos sumados por familias; las listas locales no cuentan para calcular el ganador.",
    ceraLbl: "Voto exterior (CERA)", egoiliarrak: "residentes", ceraBarne: "Ya está sumado en los resultados de arriba (territorios y total). La capa de participación del mapa va sin él (residentes).",
    ufAzalpena: "Diferencia entre los votos de un mismo partido o bloque en las municipales y en su equivalente foral: Juntas Generales en la CAV y Parlamento en Navarra (el mismo día), cantonales más cercanas en Iparralde. «Total»: la mitad de la suma de las diferencias, es decir, la parte del electorado que votó distinto.",
    botoAldaketaOsoa: "cambio total de voto", guztiraAukera: "Total (cambio total de voto)",
    ikuspegiaAzalpena: "Hegoalde por partidos; Euskal Herria entera e Iparralde por bloques (salvo las municipales de Iparralde, por listas).",
    konparatzekoa: "Elección con la que comparar", hauteskundeMotak: "Tipos de elección",
    hutsaKanpoan: "Esta elección no se celebra en esta zona",
    hutsaKantoia: "Este cantón no votó en las departamentales de 2011: solo se renovó la mitad de los cantones",
    hutsaMuga: "Esta sección no tiene resultado propio en esta elección (cambiaron sus límites o votó junto con otra sección). Ver los datos del municipio",
    hutsaIturririk: "La fuente oficial no tiene resultados para esta zona (por ejemplo, porque no se presentó ninguna lista)",
    hutsaLegenda: "Rayado: sin datos (pasa el ratón por encima para ver el motivo)",
    sekzioBatera: "En esta elección, esta sección votó junto con esta otra (se creó después de cerrarse el censo):",
    hautagaiak: "Candidaturas", kantonamenduOfizialak: "Cantones oficiales",
    kantonamenduAzalpena: "Baiona y Angelu están repartidos entre varios cantones: en el mapa aparecen juntos, con Bokale, y aquí el resultado oficial de cada cantón, sumado mesa a mesa.",
    tokikoak: "Listas locales", gainontzekoak: "Otros", daturikEz: "Sin datos",
    tresnakEzkutatu: "Ocultar herramientas", tresnakErakutsi: "Mostrar herramientas",
    panelaZabaldu: "Abrir / cerrar el panel", 
    laburpenikEz: "Esta zona no tiene datos en esta elección", botoak: "Votos",
    ufEzin: "No comparable: el voto municipal es casi todo de listas sin clasificar (sin partidos)", ufForua: "equivalente foral", bilakaera: "Evolución", bilakaeraHautatu: "Selecciona una zona en el mapa para ver cómo ha votado desde 2011.", bilCera: "Participación de residentes; porcentajes con el voto exterior (CERA) donde la fuente lo da.", bilOsatugabe: "Puntos huecos: elecciones que no cubren toda Euskal Herria (de alguna parte no hay datos de esa fecha); no se unen con las demás.", bilBakarrik: (z) => `solo ${z}`, bilakaeraGrafikoa: "Evolución del voto", partaidetza: "Participación", zinegotziakLabur: "Conc.", bozkenEhunekoa: "% de voto", hauteskundez: "Elección a elección",
    eserlekuak: "Escaños", gehiengoa: "Mayoría absoluta", barrutika: "Por circunscripción", udala: "ayuntamiento", herrialdeka: "Por territorio",
    zinegotziakEH: "Concejales en Euskal Herria (por bloques)", zinegotziak: "Concejales",
    eserlekurikEzHemen: "La zona seleccionada no tiene escaños en estas instituciones (en Iparralde se deciden en segunda vuelta).",
    zinegotziHautatu: "Selecciona un municipio para ver la composición de su ayuntamiento.",
    zinegotzirikEz: "El fichero de primera vuelta no trae concejales (en Iparralde, sobre todo municipios que necesitaron segunda vuelta)",
    zinegotzirikEzN: "municipios sin datos de concejales en el fichero de primera vuelta (en Iparralde, sobre todo los que necesitaron segunda vuelta: Baiona, Miarritze…)",
    dhondtAzalpena: "Los escaños del Parlamento de Navarra se calculan aquí con la ley d'Hondt y la barrera del 3 %, a partir de los votos por mesa; comprobados con los resultados oficiales.",
    eserlekuIparralde: "En Iparralde (legislativas, departamentales, regionales, presidenciales) los escaños se deciden en segunda vuelta; el Behatokia solo recoge la primera.",
    eserlekuEuropa: "En el Parlamento Europeo España y Francia son una circunscripción única: no hay reparto de escaños de Euskal Herria.",
    eserlekurikEz: "No hay datos de escaños para esta elección.",
    fedIzena: "Parlamento Federal Vasco", fedSimulazioa: "simulación", fedJolastu: "Forma tu coalición de gobierno", fedKoalizioa: "Escaños de la coalición",
    fedTaldeak: "Grupos parlamentarios", fedHasi: "Pulsa los grupos para formar la coalición", fedLortuta: "¡Mayoría absoluta! Has formado gobierno", fedFalta: "faltan",
    fedGarbitu: "Vaciar", fedTxikienak: "Coaliciones ganadoras mínimas",
    fedMetodoa: "Método: ley d'Hondt en cada territorio, con barrera del 3 % de los votos a candidaturas. En Hegoalde se reparte por partidos y en Iparralde por bloques; en el parlamento los escaños se agrupan por bloques. Las listas locales sin clasificar no entran. No es una institución real: es un ejercicio.",
    dataAukeratu: "Fecha: en cada zona, las últimas elecciones hasta esa fecha", gaur: "Hoy", erreproduzitu: "Reproducir", gelditu: "Parar",
  },
  fr: {
    erakundeak: {"Eusko Legebiltzarra": "Parlement basque", "Nafarroako Parlamentua": "Parlement de Navarre", "Arabako Batzar Nagusiak": "Juntes générales d'Alava", "Bizkaiko Batzar Nagusiak": "Juntes générales de Biscaye", "Gipuzkoako Batzar Nagusiak": "Juntes générales du Guipuscoa", "Diputatuen Kongresua (Hegoaldea)": "Congrès des députés (Hegoalde)"},
    kat: { udal: "Municipales", autonomikoak: "Autonomiques", foralak: "Forales", estatu: "Nationales", europa: "Européennes" },
    mota: { municipales: "Municipales", generales: "Générales (Espagne)", legislativas: "Législatives", presidenciales: "Présidentielle",
      regionales: "Régionales", departamentales: "Départementales", europeas: "Européennes", autonomicas: "Autonomiques",
      "autonomicas|EAE": "Parlement basque", "autonomicas|Nafarroa": "Parlement de Navarre", forales: "Juntes générales" },
    motaLuzea: { municipales: "Élections municipales", generales: "Élections générales (Espagne)", legislativas: "Élections législatives (France)",
      presidenciales: "Élection présidentielle (France)", regionales: "Élections régionales (Nouvelle-Aquitaine)",
      departamentales: "Élections départementales (par canton)", autonomicas: "Élections autonomiques", forales: "Élections aux Juntes générales",
      europeas: "Élections européennes", azkenak: "Dernières élections" },
    mailak: { eh: "Euskal Herria", eremua: "CAB · Nafarroa Garaia · Iparralde", territorio: "Provinces", eskualdea: "Comarques", barruti_elektorala: "Circonscriptions (Juntes générales)",
      partido_judicial: "Districts judiciaires", zona_linguistica: "Zones linguistiques (Navarre)", legegile_barrutia: "Circonscriptions législatives (Iparralde)", euskara_eremua: "Zones selon la connaissance du basque",
      kantonamendua: "Cantons (Iparralde)", muni: "Communes", sec: "Sections (recensement) · bureaux de vote" },
    blokeak: { "Ezker subiranista": "Gauches souverainistes", "EAJ": "EAJ-PNB-Geroa Bai", "Alderdi Sozialista": "Partis socialistes", "Ezker estatala": "Gauches nationales",
      "EH Bai + Ezkerrak": "EH Bai + gauches", "Zentroa": "Centre", "Eskuina": "Droite", "Ultra eskuina": "Extrême droite" },
    zonak: { Azkenak: "Dernières", "Euskal Herria": "Euskal Herria", Hegoalde: "Hegoalde", Iparralde: "Iparralde" },
    zonaLabur: { EAE: "CAB", Nafarroa: "Naf.", Hegoalde: "Heg.", Iparralde: "Ipa.", "Euskal Herria": "EH" },
    menua: "Menu", atalak: "Rubriques", mapa: "Carte", metodologia: "Méthodologie", iturriak: "Sources", guriBuruz: "À propos", legeOharra: "Mentions légales", irudiak: "Images", datuak: "Données",
    hizkuntza: "Langue", kokapena: "Emplacement", lasterbideakIzenb: "Raccourcis clavier (?)", hauteskundea: "Élection",
    satelitea: "Satellite", sateliteaIzenb: "Afficher / masquer la carte satellite (S)", mapaAria: "Carte d'Euskal Herria",
    argiaAria: "Passer à l'apparence claire", ilunaAria: "Passer à l'apparence sombre", temaAria: "Apparence claire / sombre", temaIzenb: "Apparence claire / sombre (I)",
    tresnakIzenb: "Masquer / afficher les outils (L)", bilatu: "Rechercher", udalerriaPh: "Commune…", bilatuUdalerria: "Rechercher une commune",
    mapaModua: "Couche de la carte", irabazlea: "Vainqueur", lehianEremuak: "Zones serrées", konparatuBiUrte: "Comparer deux années",
    udalForu: "Écart municipales / forales", ufselAria: "Écart municipales / forales : parti", eremua: "Échelle", automatikoa: "Automatique (selon le zoom)",
    panela: "Panneau", emaitzak: "Résultats", denboraLerroa: "Frise chronologique", azkenHauteskundeak: "Dernières élections",
    lasterbideak: "Raccourcis", itxi: "Fermer", kargatzen: "Chargement…", errorea: "Erreur",
    lagMota: "Type de carte : municipales, autonomiques, forales, nationales, européennes", lagQE: "Élection précédente / suivante",
    lagWMT: "Vainqueur, zones serrées, participation", lagCU: "Comparer deux années, écart municipales / forales", lagItxura: "Apparence claire / sombre", lagS: "Afficher / masquer le satellite",
    lagL: "Afficher / masquer le menu de gauche", lagK: "Résultats ↔ sièges (dans le panneau)", lagP: "Lire / arrêter la frise chronologique",
    lagBilatu: "Rechercher une commune", lag0: "Voir tout Euskal Herria", lagEsc: "Fermer la sélection et les fenêtres",
    udalerri: "communes", biztLabur: "hab.", biztanle: "habitants", zinegotzi: "conseillers", eserleku: "sièges", sekzioa: "section",
    botoakBlokeka: "Voix par blocs", botoakAlderdika: "Voix par partis", irabazitakoUdalerriak: "Communes remportées", mapakoKoloreak: "couleurs de la carte",
    koloreaIrabazlea: "Couleur : vainqueur de chaque zone.", grisez: "en gris", puntu: "points", irabazleAldaketa: "Changement de vainqueur",
    daturikEzHemen: "Pas de données :", vs: "vs", hauteskundeN: "élections", maila: "Échelle",
    partehartzea: "participation", errolda: "inscrits", bozkatzaileak: "votants", hautagaitzenBotoak: "voix aux candidatures",
    aldeaGuztira: "écart total", parteUdal: "particip. munic.", parteForu: "particip. forales", aldea12: "écart 1er–2e", zerrendaIrekiak: "Listes ouvertes",
    udalLabur: "Mun.", foruLabur: "For.",
    ufAzalpenaEz: "Les municipales sont comparées à leur équivalent « foral » : Juntes générales en CAB et Parlement en Navarre (le même jour), cantonales en Iparralde (les plus proches). Choisissez des municipales, des Juntes générales, le Parlement de Navarre, des cantonales ou « Dernières » dans les cartes Municipales / Forales.",
    ufIzenburua: "Écart municipales / forales", partehartzeaIzenb: "Participation", egoiliarPartehartzea: "Participation des résidents", lehian: "Serré", marjinaLegenda: "Écart entre le premier et le deuxième",
    irabazleaAldatu: "Le vainqueur a changé", irabazleBera: "Même vainqueur", hautagaitza: "Candidature", hautagaitzaBakarra: "Candidature unique",
    alderdia: "Parti", ufDaturikEz: "Pas de données · écart municipales / forales", ufDaturikEzTip: "Pas de données pour calculer l'écart municipales / forales",
    aggOharra: "Voix additionnées par familles ; les listes locales ne comptent pas pour le vainqueur.",
    ceraLbl: "Vote des résidents à l'étranger (CERA)", egoiliarrak: "résidents", ceraBarne: "Déjà inclus dans les résultats ci-dessus (territoires et total). La couche de participation de la carte ne le compte pas (résidents).",
    ufAzalpena: "Écart entre les voix d'un même parti ou bloc aux municipales et à leur équivalent « foral » : Juntes générales en CAB et Parlement en Navarre (le même jour), cantonales les plus proches en Iparralde. « Total » : la moitié de la somme des écarts, c'est-à-dire la part de l'électorat qui a voté différemment.",
    botoAldaketaOsoa: "changement de vote total", guztiraAukera: "Total (changement de vote total)",
    ikuspegiaAzalpena: "Hegoalde par partis ; Euskal Herria entier et Iparralde par blocs (sauf les municipales d'Iparralde, par listes).",
    konparatzekoa: "Élection de comparaison", hauteskundeMotak: "Types d'élection",
    hutsaKanpoan: "Cette élection n'a pas lieu dans cette zone",
    hutsaKantoia: "Ce canton n'a pas voté aux cantonales de 2011 : seule la moitié des cantons était renouvelée",
    hutsaMuga: "Cette section n'a pas de résultat propre à cette élection (ses limites ont changé ou elle a voté avec une autre section). Voir les données de la commune",
    hutsaIturririk: "La source officielle n'a pas de résultats pour cette zone (par exemple, faute de liste)",
    hutsaLegenda: "Hachuré : pas de données (survolez pour voir pourquoi)",
    sekzioBatera: "À cette élection, cette section a voté avec celle-ci (elle a été créée après la clôture des listes électorales) :",
    hautagaiak: "Candidatures", kantonamenduOfizialak: "Cantons officiels",
    kantonamenduAzalpena: "Bayonne et Anglet sont partagées entre plusieurs cantons : sur la carte elles apparaissent ensemble, avec Boucau, et ici le résultat officiel de chaque canton, additionné bureau par bureau.",
    tokikoak: "Listes locales", gainontzekoak: "Autres", daturikEz: "Pas de données",
    tresnakEzkutatu: "Masquer les outils", tresnakErakutsi: "Afficher les outils",
    panelaZabaldu: "Ouvrir / fermer le panneau", 
    laburpenikEz: "Cette zone n'a pas de données pour cette élection", botoak: "Voix",
    ufEzin: "Non comparable : le vote municipal va presque entièrement à des listes non classées (sans partis)", ufForua: "équivalent foral", bilakaera: "Évolution", bilakaeraHautatu: "Sélectionnez une zone sur la carte pour voir comment elle a voté depuis 2011.", bilCera: "Participation des résidents ; pourcentages avec le vote de l'étranger (CERA) quand la source le donne.", bilOsatugabe: "Points creux : élections qui ne couvrent pas tout Euskal Herria (il manque les données d'une partie à cette date) ; ils ne sont pas reliés aux autres.", bilBakarrik: (z) => `${z} seulement`, bilakaeraGrafikoa: "Évolution du vote", partaidetza: "Participation", zinegotziakLabur: "Cons.", bozkenEhunekoa: "% des voix", hauteskundez: "Élection par élection",
    eserlekuak: "Sièges", gehiengoa: "Majorité absolue", barrutika: "Par circonscription", udala: "conseil municipal", herrialdeka: "Par province",
    zinegotziakEH: "Conseillers municipaux en Euskal Herria (par blocs)", zinegotziak: "Conseillers municipaux",
    eserlekurikEzHemen: "La zone sélectionnée n'a pas de sièges dans ces institutions (en Iparralde, ils se décident au second tour).",
    zinegotziHautatu: "Sélectionnez une commune pour voir la composition de son conseil municipal.",
    zinegotzirikEz: "Le fichier du premier tour ne donne pas les conseillers (en Iparralde, surtout les communes qui ont eu besoin d'un second tour)",
    zinegotzirikEzN: "communes sans données de conseillers dans le fichier du premier tour (en Iparralde, surtout celles qui ont eu un second tour : Bayonne, Biarritz…)",
    dhondtAzalpena: "Les sièges du Parlement de Navarre sont calculés ici selon la méthode d'Hondt et le seuil de 3 %, à partir des voix par bureau ; vérifiés avec les résultats officiels.",
    eserlekuIparralde: "En Iparralde (législatives, départementales, régionales, présidentielle), les sièges se décident au second tour ; le Behatokia ne recueille que le premier.",
    eserlekuEuropa: "Au Parlement européen, l'Espagne et la France forment chacune une circonscription unique : il n'y a pas de répartition des sièges pour Euskal Herria.",
    eserlekurikEz: "Pas de données de sièges pour cette élection.",
    fedIzena: "Parlement fédéral basque", fedSimulazioa: "simulation", fedJolastu: "Formez votre coalition de gouvernement", fedKoalizioa: "Sièges de la coalition",
    fedTaldeak: "Groupes parlementaires", fedHasi: "Cliquez sur les groupes pour former la coalition", fedLortuta: "Majorité absolue ! Vous avez formé un gouvernement", fedFalta: "il manque",
    fedGarbitu: "Vider", fedTxikienak: "Coalitions gagnantes minimales",
    fedMetodoa: "Méthode : méthode d'Hondt dans chaque province, avec un seuil de 3 % des voix aux candidatures. En Hegoalde par partis et en Iparralde par blocs ; au parlement, les sièges sont regroupés par blocs. Les listes locales non classées n'entrent pas. Ce n'est pas une institution réelle : c'est un exercice.",
    dataAukeratu: "Date : dans chaque zone, les dernières élections jusqu'à cette date", gaur: "Aujourd'hui", erreproduzitu: "Lire", gelditu: "Arrêter",
  },
  en: {
    erakundeak: {"Eusko Legebiltzarra": "Basque Parliament", "Nafarroako Parlamentua": "Parliament of Navarre", "Arabako Batzar Nagusiak": "General Assembly of Araba", "Bizkaiko Batzar Nagusiak": "General Assembly of Bizkaia", "Gipuzkoako Batzar Nagusiak": "General Assembly of Gipuzkoa", "Diputatuen Kongresua (Hegoaldea)": "Spanish Congress (Hegoalde)"},
    kat: { udal: "Local", autonomikoak: "Regional", foralak: "Foral", estatu: "State", europa: "European" },
    mota: { municipales: "Local", generales: "Spanish general", legislativas: "French legislative", presidenciales: "French presidential",
      regionales: "French regional", departamentales: "Departmental", europeas: "European", autonomicas: "Regional",
      "autonomicas|EAE": "Basque Parliament", "autonomicas|Nafarroa": "Parliament of Navarre", forales: "General Assemblies" },
    motaLuzea: { municipales: "Local elections", generales: "General elections (Spain)", legislativas: "Legislative elections (France)",
      presidenciales: "Presidential election (France)", regionales: "Regional elections (Nouvelle-Aquitaine)",
      departamentales: "Departmental elections (by canton)", autonomicas: "Regional parliament elections", forales: "General Assembly elections",
      europeas: "European elections", azkenak: "Latest elections" },
    mailak: { eh: "Euskal Herria", eremua: "BAC · Nafarroa Garaia · Iparralde", territorio: "Provinces", eskualdea: "Districts", barruti_elektorala: "Constituencies (General Assemblies)",
      partido_judicial: "Judicial districts", zona_linguistica: "Language zones (Navarre)", legegile_barrutia: "Legislative constituencies (Iparralde)", euskara_eremua: "Areas by knowledge of Basque",
      kantonamendua: "Cantons (Iparralde)", muni: "Municipalities", sec: "Census sections" },
    blokeak: { "Ezker subiranista": "Pro-independence left parties", "EAJ": "EAJ-PNV-Geroa Bai", "Alderdi Sozialista": "Socialist parties", "Ezker estatala": "State-wide left parties",
      "EH Bai + Ezkerrak": "EH Bai + left parties", "Zentroa": "Centre", "Eskuina": "Right", "Ultra eskuina": "Far right" },
    zonak: { Azkenak: "Latest", "Euskal Herria": "Euskal Herria", Hegoalde: "Hegoalde", Iparralde: "Iparralde" },
    zonaLabur: { EAE: "BAC", Nafarroa: "Naf.", Hegoalde: "Heg.", Iparralde: "Ipa.", "Euskal Herria": "EH" },
    menua: "Menu", atalak: "Sections", mapa: "Map", metodologia: "Methodology", iturriak: "Sources", guriBuruz: "About", legeOharra: "Legal notice", irudiak: "Imagery", datuak: "Data",
    hizkuntza: "Language", kokapena: "Location", lasterbideakIzenb: "Keyboard shortcuts (?)", hauteskundea: "Election",
    satelitea: "Satellite", sateliteaIzenb: "Show / hide the satellite map (S)", mapaAria: "Map of Euskal Herria",
    argiaAria: "Switch to light appearance", ilunaAria: "Switch to dark appearance", temaAria: "Light / dark appearance", temaIzenb: "Light / dark appearance (I)",
    tresnakIzenb: "Hide / show tools (L)", bilatu: "Search", udalerriaPh: "Municipality…", bilatuUdalerria: "Search municipality",
    mapaModua: "Map layer", irabazlea: "Winner", lehianEremuak: "Close races", konparatuBiUrte: "Compare two years",
    udalForu: "Local / provincial gap", ufselAria: "Local / provincial gap: party", eremua: "Level", automatikoa: "Automatic (by zoom)",
    panela: "Panel", emaitzak: "Results", denboraLerroa: "Timeline", azkenHauteskundeak: "Latest elections",
    lasterbideak: "Shortcuts", itxi: "Close", kargatzen: "Loading…", errorea: "Error",
    lagMota: "Map type: local, regional, foral (provincial assemblies), state, European", lagQE: "Previous / next election",
    lagWMT: "Winner, close races, turnout", lagCU: "Compare two years, local / provincial gap", lagItxura: "Light / dark appearance", lagS: "Show / hide satellite",
    lagL: "Show / hide the left menu", lagK: "Results ↔ seats (in the panel)", lagP: "Play / stop the timeline",
    lagBilatu: "Search a municipality", lag0: "Show all of Euskal Herria", lagEsc: "Close the selection and windows",
    udalerri: "municipalities", biztLabur: "inhab.", biztanle: "inhabitants", zinegotzi: "councillors", eserleku: "seats", sekzioa: "section",
    botoakBlokeka: "Votes by bloc", botoakAlderdika: "Votes by party", irabazitakoUdalerriak: "Municipalities won", mapakoKoloreak: "map colours",
    koloreaIrabazlea: "Colour: winner in each area.", grisez: "in grey", puntu: "points", irabazleAldaketa: "Change of winner",
    daturikEzHemen: "No data:", vs: "vs", hauteskundeN: "elections", maila: "Level",
    partehartzea: "turnout", errolda: "electorate", bozkatzaileak: "voters", hautagaitzenBotoak: "votes for candidates",
    aldeaGuztira: "total gap", parteUdal: "local turnout", parteForu: "prov. turnout", aldea12: "1st–2nd gap", zerrendaIrekiak: "Open lists",
    udalLabur: "Loc.", foruLabur: "Prov.",
    ufAzalpenaEz: "Local elections are compared with their provincial-level counterpart: General Assemblies in the BAC and Parliament in Navarre (same day), cantonal elections in Iparralde (the nearest). Choose a local election, a General Assembly election, the Parliament of Navarre, a cantonal election or «Latest» in the Local / Provincial maps.",
    ufIzenburua: "Local / foral gap", partehartzeaIzenb: "Turnout", egoiliarPartehartzea: "Turnout of residents", lehian: "Close race", marjinaLegenda: "Gap between first and second",
    irabazleaAldatu: "Winner changed", irabazleBera: "Same winner", hautagaitza: "Candidacy", hautagaitzaBakarra: "Single candidacy",
    alderdia: "Party", ufDaturikEz: "No data · local / provincial gap", ufDaturikEzTip: "No data to compute the local / provincial gap",
    aggOharra: "Votes added up by party family; local lists do not count towards the winner.",
    ceraLbl: "Vote from abroad (CERA)", egoiliarrak: "residents", ceraBarne: "Already added to the results above (territories and total). The map's turnout layer leaves it out (residents only).",
    ufAzalpena: "Gap between the votes of the same party or bloc in local elections and in their provincial-level counterpart: General Assemblies in the BAC and Parliament in Navarre (same day), the nearest cantonal elections in Iparralde. «Total»: half the sum of the gaps, i.e. the share of voters who voted differently.",
    botoAldaketaOsoa: "total vote shift", guztiraAukera: "Total (total vote shift)",
    ikuspegiaAzalpena: "Hegoalde by party; all of Euskal Herria and Iparralde by bloc (except local elections in Iparralde, by list).",
    konparatzekoa: "Election to compare with", hauteskundeMotak: "Election types",
    hutsaKanpoan: "This election is not held in this area",
    hutsaKantoia: "This canton did not vote in the 2011 cantonal elections: only half of the cantons were renewed",
    hutsaMuga: "This section has no result of its own in this election (its boundaries changed or it voted together with another section). See the municipality's data",
    hutsaIturririk: "The official source has no results for this area (for example, because no list stood)",
    hutsaLegenda: "Hatched: no data (hover to see why)",
    sekzioBatera: "In this election, this section voted together with this one (it was created after the electoral roll closed):",
    hautagaiak: "Candidates", kantonamenduOfizialak: "Official cantons",
    kantonamenduAzalpena: "Baiona and Angelu are split between several cantons: on the map they appear together, with Bokale, and here is each canton's official result, added up polling station by polling station.",
    tokikoak: "Local lists", gainontzekoak: "Others", daturikEz: "No data",
    tresnakEzkutatu: "Hide tools", tresnakErakutsi: "Show tools",
    panelaZabaldu: "Open / close the panel", 
    laburpenikEz: "This area has no data in this election", botoak: "Votes",
    ufEzin: "Not comparable: almost all the local vote went to unclassified lists (no parties)", ufForua: "provincial counterpart", bilakaera: "Trend", bilakaeraHautatu: "Select an area on the map to see how it has voted since 2011.", bilCera: "Turnout of residents; percentages include the vote from abroad (CERA) where the source gives it.", bilOsatugabe: "Hollow points: elections that do not cover all of Euskal Herria (data for some part are missing at that date); they are not joined to the rest.", bilBakarrik: (z) => `${z} only`, bilakaeraGrafikoa: "Vote trend", partaidetza: "Turnout", zinegotziakLabur: "Cllrs", bozkenEhunekoa: "Vote %", hauteskundez: "Election by election",
    eserlekuak: "Seats", gehiengoa: "Absolute majority", barrutika: "By constituency", udala: "council", herrialdeka: "By province",
    zinegotziakEH: "Councillors in Euskal Herria (by bloc)", zinegotziak: "Councillors",
    eserlekurikEzHemen: "The selected area has no seats in these institutions (in Iparralde they are decided in the second round).",
    zinegotziHautatu: "Select a municipality to see the make-up of its council.",
    zinegotzirikEz: "The first-round file has no councillor data (in Iparralde, mostly municipalities that needed a second round)",
    zinegotzirikEzN: "municipalities without councillor data in the first-round file (in Iparralde, mostly those that needed a second round: Baiona, Miarritze…)",
    dhondtAzalpena: "Seats in the Parliament of Navarre are calculated here with the d'Hondt method and a 3 % threshold, from polling-station votes; checked against the official results.",
    eserlekuIparralde: "In Iparralde (legislative, departmental, regional, presidential), seats are decided in the second round; the Behatokia only covers the first.",
    eserlekuEuropa: "In the European Parliament, Spain and France are each a single constituency: there is no seat allocation for Euskal Herria.",
    eserlekurikEz: "No seat data for this election.",
    fedIzena: "Basque Federal Parliament", fedSimulazioa: "simulation", fedJolastu: "Build your government coalition", fedKoalizioa: "Coalition seats",
    fedTaldeak: "Parliamentary groups", fedHasi: "Click the groups to build the coalition", fedLortuta: "Absolute majority! You have formed a government", fedFalta: "short by",
    fedGarbitu: "Clear", fedTxikienak: "Minimal winning coalitions",
    fedMetodoa: "Method: d'Hondt in each province, with a 3 % threshold of votes for candidates. Hegoalde is allocated by party and Iparralde by bloc; in parliament, seats are grouped by bloc. Unclassified local lists are left out. It is not a real institution: it is an exercise.",
    dataAukeratu: "Date: in each area, the latest elections up to that date", gaur: "Today", erreproduzitu: "Play", gelditu: "Stop",
  },
};
// T: los textos del idioma elegido; lo que falte, en euskera (también dentro de los grupos: kat, mota…)
const T = (() => {
  const t = Object.assign({}, TESTUAK.eu, TESTUAK[HIZK]);
  for (const k of Object.keys(TESTUAK.eu)) if (typeof TESTUAK.eu[k] === "object") t[k] = Object.assign({}, TESTUAK.eu[k], (TESTUAK[HIZK] || {})[k]);
  return t;
})();

// Textos fijos de la página (template.html): data-t (contenido), data-t-title, data-t-aria, data-t-ph (marcador);
// «mailak.muni» = T.mailak.muni. Enlaces a las páginas estáticas, en su versión del idioma. Selector de idioma.
const tGako = (k) => k.split(".").reduce((o, x) => o && o[x], T);
document.documentElement.lang = HIZK;
for (const [atr, jarri] of [["data-t", (e, v) => { e.textContent = v; }], ["data-t-title", (e, v) => e.setAttribute("title", v)],
  ["data-t-aria", (e, v) => e.setAttribute("aria-label", v)], ["data-t-ph", (e, v) => e.setAttribute("placeholder", v)]])
  document.querySelectorAll(`[${atr}]`).forEach((e) => { const v = tGako(e.getAttribute(atr)); if (typeof v === "string") jarri(e, v); });
document.querySelectorAll("[data-orria]").forEach((a) => { a.href = HIZK === "eu" ? `${a.dataset.orria}.html` : `${a.dataset.orria}.${HIZK}.html`; });
{
  const nav = document.getElementById("hizkuntzak");  // desplegable al final de la barra: «EU ▾»
  if (nav) {
    nav.querySelector("summary").textContent = HIZK.toUpperCase();
    nav.querySelector(".hizk-menua").innerHTML = Object.keys(HIZKUNTZAK).map((l) => `<button type="button" lang="${l}" data-l="${l}"${l === HIZK ? ' aria-current="true"' : ""}><b>${l.toUpperCase()}</b> ${HIZKUNTZAK[l]}</button>`).join("");
    document.addEventListener("click", (e) => { if (nav.open && !nav.contains(e.target)) nav.open = false; });  // se cierra al pinchar fuera
    nav.addEventListener("click", (e) => {  // cambiar de idioma: se guarda y se recarga con el mismo enlace
      const b = e.target.closest("[data-l]"); if (!b || b.dataset.l === HIZK) return;
      try { localStorage.setItem("behatokia-hizkuntza", b.dataset.l); } catch { /* sin almacenamiento */ }
      const q = new URLSearchParams(location.hash.slice(1)); if (b.dataset.l === "eu") q.delete("l"); else q.set("l", b.dataset.l);
      location.hash = q.toString(); location.reload();
    });
  }
}
const $ = (s) => document.querySelector(s);
// Todo texto que venga de los datos (nombres de lista, municipios…) se escapa antes de meterlo en el HTML
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => n == null ? "–" : n.toLocaleString(LOKALEA);
const pct = (n) => n == null ? "–" : n.toLocaleString(LOKALEA, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
const dfmt = (d) => d == null ? "" : `<span class="${d > 0 ? "up" : d < 0 ? "down" : ""}">${d > 0 ? "▲" : d < 0 ? "▼" : "="} ${Math.abs(d).toLocaleString(LOKALEA, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>`;
const BASE = (() => { let b = location.href.split(/[?#]/)[0]; if (/\.html?$/i.test(b)) b = b.slice(0, b.lastIndexOf("/") + 1); if (!b.endsWith("/")) b += "/"; return b; })();
// Huella del contenido de data/ y geo/ (la pone build_map.py). Va en la URL de cada fichero: si los
// datos cambian, cambia la URL y el navegador no reutiliza la copia vieja de su caché.
const VERSION = "782cb9919f0c";
// Los datos se cargan con fetch() desde el propio sitio (Cloudflare Pages o python -m http.server)
const load = async (u) => {
  const r = await fetch(new URL(`${u}?v=${VERSION}`, BASE).href, { cache: "force-cache" });
  if (!r.ok) throw new Error(`ezin kargatu: ${u} (${r.status})`);
  return r.json();
};
// Deja que el navegador pinte antes del trabajo pesado: así el toque se ve respondido enseguida (el botón activo, la
// elección nueva) y el mapa se recolorea en el fotograma siguiente. Es lo que mide el INP de Core Web Vitals.
// (con la pestaña oculta no hay fotogramas: a los 100 ms sigue igualmente)
const arnasa = () => new Promise((r) => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 100); });
window.addEventListener("unhandledrejection", (e) => { const l = $("#loading"); if (l) { l.hidden = false; l.textContent = `${T.errorea}: ` + (e.reason && e.reason.message || e.reason); } });

// (MapLibre 6 carga su worker, vendor/maplibre-gl-worker.mjs, por su cuenta: no hay que indicarlo)

// Arranque rápido: solo lo imprescindible para el primer mapa y el panel, todo a la vez; los contornos
// municipales, los escaños y las elecciones anteriores (flechas ▲▼) llegan justo después (ver 10-abiarazi.js)
const [INDEX, G_EH, G_ERE, G_LUR, IZENAK, MASKARAK] = await Promise.all([load("data/index.json"), load("geo/eremuak_eh.json"),
  load("geo/eremuak_eremua.json"), load("geo/eremuak_territorio.json"), load("geo/izenak.json"), load("geo/maskarak.json")]);
// El herrialde y el ámbito, en pantalla: en los datos Nafarroa es la clave (y «Behe Nafarroa», otro herrialde)
const IZEN_PANTAILA = { Nafarroa: "Nafarroa Garaia" };
const lurIzena = (n) => IZEN_PANTAILA[n] || n;
// Nivel «eremua»: la CAV con su nombre en cada idioma (EAE, CAV, CAB, BAC); Nafarroa Garaia e Iparralde, igual en todos
const eremuIzena = (n) => n === "EAE" ? T.zonaLabur.EAE : lurIzena(n);
const FAM = INDEX.familias, LEVELS = INDEX.levels, MUNIS = INDEX.munis;
let ESERLEKUAK = {};  // escaños por institución (pestaña Eserlekuak): se cargan después del primer pintado
// Candidaturas sin clasificar: «Tokiko zerrendak» en las municipales; en las demás elecciones, «Gainontzekoak»
const lokalak = () => state.mapa === "udal" ? T.tokikoak : T.gainontzekoak;
// Nombre de una familia o un bloque, sin fecha (Bilakaera: una línea para toda la serie)
const famIzena = (f) => f === "LOCAL" ? lokalak() : esc(T.blokeak[f] || INDEX.corta[f] || f);  // bloques, en el idioma elegido
// Las siglas cambian con los años (EB / IU → Podemos / IU → Podemos / Sumar, web_konfig.FAMILIA_SIGLAK): en el panel,
// las de la elección que se ve. Se resuelven una vez por elección (short() se llama en cada fila).
const dataIzen = (s) => { const [y, m] = String(s).split("-").map(Number); return y + ((m || 1) - 1) / 12; };
let siglaKachea = { k: null, m: {} };
function siglakUnekoak() {
  const k = state.hauteskundea;
  if (siglaKachea.k === k) return siglaKachea.m;
  const t = Math.max(...osagaiak(k).map(dataZ).filter(Number.isFinite));
  const m = {};
  for (const f in (INDEX.siglak || {})) { const e = INDEX.siglak[f].filter(([d]) => dataIzen(d) <= t + 1e-6).at(-1); if (e) m[f] = e[1]; }
  siglaKachea = { k, m }; return m;
}
const short = (f) => f === "LOCAL" ? lokalak() : esc(T.blokeak[f] || siglakUnekoak()[f] || INDEX.corta[f] || f);

// Un "nivel" = una fuente de geometría. Los cuatro primeros se encadenan por zoom.
// "sec": secciones censales del año de la elección (se cargan al llegar a ese nivel, ver sekzioakKargatu)
// Cada nivel con su geometría. Al arrancar solo "eh", "eremua" y "territorio"; "muni" llega justo después del primer pintado
// (10-abiarazi.js), "sec" al acercarse (sekzioakKargatu) y el resto de niveles al necesitarlos (mailaKargatu).
// El orden de las claves es el de las capas del mapa.
const hutsa = () => ({ type: "FeatureCollection", features: [] });
const GEO = { muni: hutsa(), sec: hutsa() };
for (const k of Object.keys(INDEX.levels)) GEO[k] = k === "territorio" ? G_LUR : k === "eremua" ? G_ERE : hutsa();
GEO.eh = G_EH;
const mailaKargak = {};
function mailaKargatu(l) {  // geometría de un nivel de agregación (eskualdea, barrutiak…), una sola vez
  if (!(l in INDEX.levels) || GEO[l].features.length) return Promise.resolve();
  return (mailaKargak[l] = mailaKargak[l] || load(`geo/eremuak_${l}.json`).then((g) => {
    for (const f of g.features) { f.properties.fid = f.id; NAME[f.id] = esc(f.properties.name); }
    GEO[l] = g; sucio.add(l);
    const muga = l === "eskualdea" && typeof map !== "undefined" && map.getSource("muga-esk"); if (muga) muga.setData(g);
  }));
}
// "eh": todo el ámbito de la convocatoria en un solo polígono (vista inicial); acercándose, la CAV, Nafarroa e Iparralde
// («eremua») y luego los herrialdes. En el modo udal/foru, y con una elección concreta de solo la CAV o solo Nafarroa (no
// hay polígono de conjunto para ellas), el nivel más general es «eremua»
const ehGabe = () => state.modua === "udalforal" || (bakarrikDa() && ["EAE", "Nafarroa"].includes(eremua(state.hauteskundea)));
const autoMailak = () => !ehGabe() ? AUTO
  : AUTO.filter(a => a[0] !== "eh").map((a, i) => i ? a : [a[0], 0, a[2]]);
const NAME = {};
for (const k in GEO) for (const f of GEO[k].features) { f.properties.fid = f.id; NAME[f.id] = esc(k === "eremua" ? eremuIzena(f.properties.name) : k === "territorio" ? lurIzena(f.properties.name) : f.properties.name); }

// state.mapa = categoría (udal, eskualde, estatu, europa); state.hauteskundea / state.konparatu = convocatoria
// concreta, p. ej. "municipales_2023" o "legislativas_2024-06" (= nombre del fichero de datos)
const state = { mapa: "udal", hauteskundea: null, konparatu: null, modua: "winner", maila: "auto", hautatua: null, satelitea: true, fitxa: "emaitzak",
                denboraT: null,  // línea de tiempo: en cada zona, sus últimas elecciones hasta la fecha T (null = hoy)
                bakarrik: false };  // una elección concreta (semicírculo, icono de la línea de tiempo): solo ella y su territorio
const INFO = INDEX.datasets;
const hauteskundeak = () => INDEX.kategoriak[state.mapa];
const zona = (k) => INFO[k].zona, mota = (k) => INFO[k].tipo;
const urtea = (k) => (k ? INFO[k].anio : "–");                      // "2023", "2019-11"
// Nombre de una convocatoria en el idioma elegido: «Legebiltzarra 2024-04», «Azkenak: Heg. Udalak 2023 + Ipa. Udalak 2026»
function izena(k) {
  if (!k || !INFO[k]) return "–";
  if (zona(k) === "Azkenak") return `${T.zonak.Azkenak}: ` + (INFO[k].osagaiak || []).map(x => `${T.zonaLabur[eremua(x)] || ""} ${izena(x)}`).join(" + ");
  return `${T.mota[`${mota(k)}|${eremua(k)}`] || T.mota[mota(k)] || mota(k)} ${urtea(k)}`;
}
// Hegoalde e Iparralde votan en fechas distintas: cada convocatoria se compara con la anterior del
// mismo tipo y la misma zona (2026 con 2020 en Iparralde; legislativas con legislativas)
const eremua = (k) => INFO[k].eremua || zona(k);  // EAE / Nafarroa dentro de Hegoalde
// Anteriores a 2011, la última de cada tipo y zona (scripts/web_datuak.py, «aurrekoak»): no se eligen ni salen en la línea de
// tiempo; completan las primeras de 2011 (en cada zona, su última elección hasta esa fecha) y son su anterior en ▲▼
const aurrekoKat = (kat = state.mapa) => (INDEX.aurrekoak || {})[kat] || [];
const aurrekoa = (k) => { const ks = [...aurrekoKat(), ...hauteskundeak()].filter(x => eremua(x) === eremua(k) && mota(x) === mota(k)), i = ks.indexOf(k); return i > 0 ? ks[i - 1] : null; };
// Por defecto, "Azkenak": las últimas elecciones de la categoría en cada zona, en un solo mapa
const azkena = () => hauteskundeak().find(k => zona(k) === "Azkenak") || hauteskundeak().at(-1);
state.hauteskundea = azkena(); state.konparatu = aurrekoa(state.hauteskundea) || state.hauteskundea;
// ---- estado en la URL: #k=estatu&y=presidenciales_2022-04&m=winner&s=48020&p=-1.6,43.0,8.2 ----
// Así una vista concreta se puede compartir con un enlace. Se lee al abrir y se reescribe en cada cambio.
const URL0 = new URLSearchParams(location.hash.slice(1));
if (INDEX.kategoriak[URL0.get("k")]) state.mapa = URL0.get("k");
state.hauteskundea = hauteskundeak().includes(URL0.get("y")) ? URL0.get("y") : azkena();
state.konparatu = hauteskundeak().includes(URL0.get("c")) ? URL0.get("c") : aurrekoa(state.hauteskundea) || state.hauteskundea;
if (MODOS.includes(URL0.get("m"))) state.modua = URL0.get("m");
if (["eserlekuak", "bilakaera"].includes(URL0.get("f"))) state.fitxa = URL0.get("f");  // pestaña del panel
// (la fecha va con tres decimales: noviembre de 2019 = 2019.833, un poco antes de la elección; nunca antes de ella)
if (zona(state.hauteskundea) !== "Azkenak") state.denboraT = URL0.has("t") && Number.isFinite(+URL0.get("t")) ? Math.max(+URL0.get("t"), dataZ(state.hauteskundea)) : dataZ(state.hauteskundea);
state.bakarrik = URL0.get("b") === "1" && zona(state.hauteskundea) !== "Azkenak";
const POS_URL = (URL0.get("p") || "").split(",").map(Number);
function urlaIdatzi() {
  const q = new URLSearchParams({ k: state.mapa, y: state.hauteskundea, m: state.modua });
  if (state.modua === "compare") q.set("c", state.konparatu);
  if (state.modua === "udalforal" && state.ufAlderdia !== "__guztira") q.set("u", state.ufAlderdia);
  if (state.hautatua) q.set("s", state.hautatua);
  if (state.fitxa !== "emaitzak") q.set("f", state.fitxa);
  if (HIZK !== "eu") q.set("l", HIZK);
  if (state.denboraT != null) q.set("t", state.denboraT.toFixed(3));
  if (state.bakarrik) q.set("b", "1");
  if (typeof map !== "undefined" && map.loaded()) { const c = map.getCenter(); q.set("p", `${c.lng.toFixed(3)},${c.lat.toFixed(3)},${map.getZoom().toFixed(2)}`); }
  history.replaceState(null, "", "#" + q.toString());
}

// ---- secciones censales: cada elección con el seccionado del INE del 1 de enero de su año ----
// (las secciones cambian casi cada año; con un único trazado, parte de las secciones se quedaría sin polígono)
const SEK_URTEAK = INDEX.sekzioUrteak || [];
function sekzioUrtea(k = state.hauteskundea) {  // lo elige build_map (el trazado que mejor encaja); si no, el último publicado
  const kk = zona(k) === "Azkenak" ? (INFO[k].osagaiak || [k]) : [k];
  const h = kk.find(x => INFO[x] && INFO[x].sekzioUrtea);
  return h ? INFO[h].sekzioUrtea : SEK_URTEAK.at(-1);
}
let sekUrtea = null;
// Nivel de secciones: el trazado del año y los resultados por sección (data/<k>_sec.json) de lo que se ve; los de
// las elecciones anteriores (flechas ▲▼), sin esperar
async function sekzioakKargatu() {
  const u = sekzioUrtea(), behar = [state.hauteskundea, ...osagK(),
    ...(state.modua === "compare" ? [state.konparatu, ...osagK(state.konparatu)] : []), ...(state.modua === "udalforal" ? ufPareja() || [] : [])];
  await Promise.all([
    u != null && u !== sekUrtea ? load(`geo/sekzioak_${u}.json`).then((g) => {
      for (const f of g.features) { f.properties.fid = f.id; NAME[f.id] = esc(f.properties.name); }
      GEO.sec = g; sekUrtea = u; }) : null,
    ...behar.map(sekzioDatuak)]);
  zikindu();
  // las anteriores y, en la capa «Parte-hartzea», una generación más (el puntero enseña las tres últimas)
  const gehiago = state.modua === "turnout" ? [...osagaiak(), ...aurrekoak().map(aurrekoa).filter(Boolean)] : [];
  const aur = [...aurrekoak(), ...gehiago].filter(x => datuak(x) && !datuak(x).sec);
  if (aur.length) Promise.all(aur.map(sekzioDatuak)).then(() => { if (mailaAktiboa() === "sec") margotu(); });
}
async function sekzioDatuak(k) {
  const d = datuak(k); if (!d || d.sec) return;
  if (!d._secKargatzen) d._secKargatzen = load(`data/${k}_sec.json`).then((s) => { d.sec = s; });
  await d._secKargatzen;
}
// El aviso "Kargatzen…" se ve mientras quede alguna descarga pendiente (pueden ir varias a la vez)
const cache = {}, enCurso = {};
let pendientes = 0;
async function kargatu(k) {
  if (cache[k]) return cache[k];
  if (!enCurso[k]) {
    pendientes++; $("#loading").hidden = false;
    enCurso[k] = load(`data/${k}.json`).then((d) => { cache[k] = d; return d; })
      .finally(() => { if (--pendientes === 0) $("#loading").hidden = true; });
  }
  return enCurso[k];
}
const datuak = (k) => cache[k || state.hauteskundea];
// Complementos: la convocatoria elegida se completa con la equivalente de las otras zonas (présidentielles
// de Iparralde + Congreso de Hegoalde…), según el mapa (categoría). Cada municipio o territorio se busca en
// la suya; el total de Euskal Herria suma todas.
// Línea de tiempo: con fecha T, en cada zona la última elección de ese tipo hasta T (con T = hoy, los
// complementos de siempre y «Azkenak»)
const ZONA_LABUR = T.zonaLabur;  // EAE, Naf., Heg., Ipa., EH (según el idioma)
// Una elección concreta elegida en el semicírculo o en la línea de tiempo: solo ella, sin las de otras zonas
const bakarrikDa = (k = state.hauteskundea) => state.bakarrik && k === state.hauteskundea && zona(k) !== "Azkenak";
// Si dos elecciones cubren alguna zona en común (EAE, Nafarroa, Iparralde), como web_konfig.EREMU_MULTZOA
const EREMU_ZATIAK = { Hegoalde: ["EAE", "Nafarroa"], "Euskal Herria": ["EAE", "Nafarroa", "Iparralde"] };
const eremuZatiak = (k) => EREMU_ZATIAK[eremua(k)] || [eremua(k)];
const gainjarri = (a, b) => eremuZatiak(a).some(z => eremuZatiak(b).includes(z));
function osag(k) {
  k = k || state.hauteskundea;
  if (bakarrikDa(k)) return { k: [], izena: "" };
  if (state.denboraT != null && k === state.hauteskundea && zona(k) !== "Azkenak") {
    // solo las otras zonas: la de la elección elegida ya está (las presidenciales no se suman a las legislativas de Iparralde)
    const z = denboraZatiak(state.denboraT).filter(x => !gainjarri(x, k));
    return { k: z, izena: z.map(x => `${ZONA_LABUR[eremua(x)] || ""} ${izena(x)}`).join(" + ") };
  }
  return ((INDEX.osagarriak || {})[state.mapa] || {})[k] || { k: [], izena: "" };
}
// Fecha de una convocatoria en años decimales (las municipales solo traen el año: mayo en Hegoalde, marzo en Iparralde)
function dataZ(k) { const [y, m] = urtea(k).split("-").map(Number); return y + ((m || (zona(k) === "Iparralde" ? 3 : 5)) - 1) / 12; }
// Tipos que forman el mapa en cada zona: los de su «Azkenak» (municipales Heg. + Ipa., Legebiltzarra + Navarra + departamentales…)
function zatiMotak(kat = state.mapa) {
  const az = INDEX.kategoriak[kat].find(k => zona(k) === "Azkenak");
  return az ? (INFO[az].osagaiak || []).map(k => [mota(k), eremua(k)]) : [];
}
const denborakoak = (kat = state.mapa) => { const m = zatiMotak(kat);
  return INDEX.kategoriak[kat].filter(k => zona(k) !== "Azkenak" && m.some(([t, e]) => t === mota(k) && e === eremua(k))).sort((a, b) => dataZ(a) - dataZ(b)); };
function denboraZatiak(T) {  // en cada zona, la última elección hasta T (las más recientes primero; también las anteriores a 2011)
  const ks = [...aurrekoKat(), ...denborakoak()];
  return zatiMotak().map(([t, e]) => ks.filter(k => mota(k) === t && eremua(k) === e && dataZ(k) <= T + 1e-6).at(-1))
    .filter(Boolean).sort((a, b) => dataZ(b) - dataZ(a));
}
const osagK = (k) => osag(k).k;
// Lo que se ve ahora (una elección, o la combinación de varias zonas) y, para las flechas ▲▼, la elección
// anterior de cada una de esas piezas: «Gaur» = Heg. 2023 + Ipa. 2026 se compara con Heg. 2019 + Ipa. 2020
const osagaiak = (k = state.hauteskundea) => zona(k) === "Azkenak" ? (INFO[k].osagaiak || []) : [k, ...osagK(k)];
const aurrekoak = (k = state.hauteskundea) => osagaiak(k).map(aurrekoa).filter(Boolean);
const ehBatuak = {};
function ehErregistroa(k) {
  const partes = [k, ...osagK(k)].map(x => datuak(x) && datuak(x).agg.eh.EH).filter(Boolean);
  if (partes.length <= 1) return partes[0] || null;
  const clave = [k, ...osagK(k)].join("+");
  if (!ehBatuak[clave]) ehBatuak[clave] = batu(partes);
  return ehBatuak[clave];
}
function batu(rs) {  // suma de resúmenes (agg.eh) de varias convocatorias
  const S = (f) => rs.reduce((a, r) => a + (f(r) || 0), 0);
  const censo = S(r => r.censo), vc = S(r => r.vc), votantes = S(r => r.part * r.censo / 100);
  // con voto exterior en alguna: la participación de los residentes, sin él (la de la capa del mapa)
  const ce = rs.some(r => r.ce) ? [S(r => r.ce && r.ce[0]), S(r => r.ce && r.ce[1])] : null;
  const junta = (listas, wons) => {
    const v = new Map(), won = {};
    listas.forEach(l => l.forEach(c => v.set(c[0], (v.get(c[0]) || 0) + c[2])));
    wons.forEach(w => Object.entries(w || {}).forEach(([f, n]) => won[f] = (won[f] || 0) + n));
    const c = [...v].sort((a, b) => b[1] - a[1]).map(([f, n]) => [f, f, n, vc ? Math.round(10000 * n / vc) / 100 : null, 0]);
    const comp = state.mapa === "udal" ? c.filter(x => x[0] !== "LOCAL") : c, g = comp[0] || c[0], s2 = comp[1];  // fuera de las municipales, también pueden ganar
    return { c, won, g: g && g[0], gf: g && g[0], gp: g && g[3], s: s2 && s2[0], sp: s2 && s2[3],
             m: g && s2 ? Math.round((g[3] - s2[3]) * 100) / 100 : null };
  };
  return { n: "Euskal Herria", t: "Euskal Herria", pob: S(r => r.pob), censo, vc, esc: S(r => r.esc), nm: S(r => r.nm), la: false,
           part: censo ? Math.round(10000 * votantes / censo) / 100 : null,
           ...(ce && censo > ce[0] ? { ce, pE: Math.round(10000 * (votantes - ce[1]) / (censo - ce[0])) / 100 } : {}),
           ...junta(rs.map(r => r.c), rs.map(r => r.won)), B: junta(rs.map(r => r.B.c), rs.map(r => r.B.won)) };
}
// ---- vista por blokeenIkuspegia (Ezker subiranista, Eskuina…), común a Hegoalde e Iparralde ----
// Los agregados traen la vista calculada ("B"); para municipios y secciones se calcula aquí a partir
// de "c". Las listas locales no se suman entre sí: dos listas de pueblo rivales no son un bloque.
const BLQ = INDEX.blq || {};
function blokeenIkuspegia(r) {
  if (r.B) return r.B;
  if (!r._B) {
    const g = new Map();
    for (const c of r.c) {
      const b = BLQ[c[1]] || "LOCAL", k = b === "LOCAL" ? "L|" + c[0] : b;
      const x = g.get(k) || [b === "LOCAL" ? c[0] : b, b, 0, 0, null];
      x[2] += c[2]; x[3] += c[3] || 0; if (c[4] != null) x[4] = (x[4] || 0) + c[4];
      g.set(k, x);
    }
    const c = [...g.values()].sort((a, b) => b[2] - a[2]).map(x => [x[0], x[1], x[2], Math.round(x[3] * 100) / 100, x[4]]);
    r._B = { c, g: c[0] ? c[0][0] : null, gf: c[0] ? c[0][1] : "LOCAL", gp: c[0] ? c[0][3] : null,
             s: c[1] ? c[1][0] : null, sp: c[1] ? c[1][3] : null, m: c[1] ? Math.round((c[0][3] - c[1][3]) * 100) / 100 : null };
  }
  return r._B;
}
// Zer ikusten den eremu bakoitzean (ez dago aukeratzeko): Hegoaldea alderdika; Euskal Herri osoa blokeka;
// Iparraldea blokeka, udal hauteskundeetan izan ezik (zerrendaka, tokiko zerrendak baitira gehienak)
function ikuspegia(level, id) {
  const ipa = level === "eh" ? id === "Iparralde" : eremuZona(level, id) === "Iparralde";
  if (level === "eh" && id === "EH") return "blokeak";
  // zonas de toda Euskal Herria (euskara-eremuak): si juntan Hegoalde e Iparralde, por bloques como el total
  if (String(id).startsWith("Euskal Herria|")) return estaldura() === "EH" ? "blokeak" : "alderdiak";
  return ipa && state.mapa !== "udal" ? "blokeak" : "alderdiak";
}
const ikusp = (r, level, id) => (!r || ikuspegia(level, id) !== "blokeak") ? r : Object.assign({}, r, blokeenIkuspegia(r));
const erregistroa = (level, id, y) => ikusp(erregistroGordina(level, id, y), level, id);
const estaldura = (k) => {  // EH, Hegoalde o Iparralde: lo que cubre lo que se ve
  k = k || state.hauteskundea;
  if (bakarrikDa(k)) return zona(k) === "Euskal Herria" ? "EH" : zona(k);  // una elección concreta: solo su zona
  return (INFO[k] || {}).estaldura || "EH";
};
// Sección: su registro; si el municipio no tiene ninguna sección en los datos (municipales de pueblos
// pequeños, que solo traen el total municipal), el del municipio. Los municipios de Iparralde van enteros.
function sekzioa(dd, id) {
  if (id.length !== 10 && !id.includes("-")) return dd.muni[id];
  if (!dd.sec) return undefined;  // las secciones aún no han llegado (data/<k>_sec.json, ver sekzioakKargatu)
  if (dd.sec[id]) return dd.sec[id];
  if (dd.secAlias && dd.secAlias[id]) return dd.sec[dd.secAlias[id]];  // votó dentro de otra sección (web_geo.sekzio_aliasak)
  if (!dd._secMunis) dd._secMunis = new Set(Object.keys(dd.sec).map(s => s.slice(0, 5)));
  return id.length === 10 && !dd._secMunis.has(id.slice(0, 5)) ? dd.muni[id.slice(0, 5)] : undefined;
}
// Si una sección se ve con los datos de otra (votó dentro de ella), cuál: «Bilbo · 05-014»; si no, null
function sekzioBatera(id, y = state.hauteskundea) {
  const s = String(id); if (mailaAktiboa() !== "sec" || s.length !== 10) return null;
  for (const x of [y, ...osagK(y)]) {
    const d = datuak(x);
    if (d && d.sec && !d.sec[s] && d.secAlias && d.secAlias[s]) { const a = d.secAlias[s];
      return `${(MUNIS[a.slice(0, 5)] || {}).n || a.slice(0, 5)} · ${a.slice(5, 7)}-${a.slice(7)}`; }
  }
  return null;
}
// El registro de un área dentro de un único conjunto de datos (sin mirar los complementos)
const erregistroDatuetan = (dd, level, id) => level === "muni" ? dd.muni[id] : level === "sec" ? sekzioa(dd, String(id))
                                                                : dd.agg[level] && dd.agg[level][id];
function erregistroGordina(level, id, y) {
  const d = datuak(y); if (!d) return null;
  if (level === "eh") return id === estaldura(y) ? ehErregistroa(y || state.hauteskundea) : null;
  const en = (dd) => erregistroDatuetan(dd, level, id);
  const propio = en(d); if (propio) return propio;
  for (const x of osagK(y)) { const dd = datuak(x); const r = dd && en(dd); if (r) return r; }
  return null;
}
const erreg = (id, y) => erregistroa(mailaAktiboa(), id, y);
// Registro con el que comparar (flechas ▲▼): la elección elegida en «Konparatu» o las anteriores de cada pieza
function aurrekoErregistroa(level, id) {
  if (state.modua === "compare") return state.konparatu !== state.hauteskundea ? erregistroa(level, id, state.konparatu) : null;
  const P = aurrekoak().filter(datuak); if (!P.length) return null;
  if (level === "eh") {  // el total solo se compara si todas las piezas tienen anterior (si no, se compararía con menos territorio)
    if (aurrekoak().length < osagaiak().length) return null;
    const zatiak = P.map(x => datuak(x).agg.eh.EH).filter(Boolean); if (!zatiak.length) return null;
    const giltza = "aurreko:" + P.join("+");
    const r = zatiak.length === 1 ? zatiak[0] : (ehBatuak[giltza] = ehBatuak[giltza] || batu(zatiak));
    return ikusp(r, "eh", id);
  }
  for (const x of P) {
    const dd = datuak(x), s = String(id);
    const r = level === "muni" ? dd.muni[s] : level === "sec" ? sekzioa(dd, s) : dd.agg[level] && dd.agg[level][s];
    if (r) return ikusp(r, level, id);
  }
  return null;
}

// ---- diferencia de voto municipales / forales ----
// Se comparan las municipales con la elección «foral» de cada zona: CAV, Juntas Generales (el mismo día); Nafarroa,
// su Parlamento (el mismo día); Iparralde, las cantonales (départementales) más cercanas en el tiempo.
// Para cada eremu: % de cada familia (o bloque) en las dos, su diferencia en puntos y la diferencia total (mitad de la
// suma de diferencias: el % de voto que "cambia"). Las listas sin clasificar cuentan como una familia; un eremu
// (municipio, comarca, cantón…) cuyo voto municipal es casi todo de listas sin clasificar no se puede comparar.
state.ufAlderdia = URL0.get("u") || "__guztira";
const UF_ZONAK = ["EAE", "Nafarroa", "Iparralde"], UF_LOKALA_MAX = 95;
const ufHurbilena = (k, ks) => ks.slice().sort((a, b) => Math.abs(dataZ(a) - dataZ(k)) - Math.abs(dataZ(b) - dataZ(k)))[0];
function ufPareak(k = state.hauteskundea) {  // {EAE: [municipales, forales], Nafarroa: [...], Iparralde: [...]}
  if (!k || !INFO[k]) return {};
  const zatiak = zona(k) === "Azkenak" ? INFO[k].osagaiak || [] : [k, ...osagK(k)], out = {};
  const ks = (tipo, z) => Object.keys(INFO).filter(x => mota(x) === tipo && zona(x) === z);
  const gehitu = (z, m, f) => { if (m && f && INFO[m] && INFO[f] && !out[z]) out[z] = [m, f]; };
  for (const x of zatiak) {
    if (!INFO[x]) continue;
    const y = urtea(x).slice(0, 4), t = mota(x), z = zona(x);
    if (t === "municipales" && z === "Hegoalde") { gehitu("EAE", x, `forales_${y}-05`); gehitu("Nafarroa", x, `autonomicas_${y}-05`); }
    if (t === "forales") gehitu("EAE", `municipales_${y}`, x);
    if (t === "autonomicas" && INFO[x].eremua === "Nafarroa") gehitu("Nafarroa", `municipales_${y}`, x);
    if (t === "municipales" && z === "Iparralde") gehitu("Iparralde", x, ufHurbilena(x, ks("departamentales", "Iparralde")));
    if (t === "departamentales") gehitu("Iparralde", ufHurbilena(x, ks("municipales", "Iparralde")), x);
  }
  if (out.Nafarroa && INFO[out.Nafarroa[1]].eremua !== "Nafarroa") delete out.Nafarroa;
  return out;
}
const ufPareja = () => [...new Set(Object.values(ufPareak()).flat())];  // todas las elecciones que hay que cargar
function ufLortu(level, id, k) {
  const d = datuak(k); if (!d) return null;
  if (level === "muni") return d.muni[id];
  if (level === "sec") return sekzioa(d, String(id));
  return d.agg[level] && d.agg[level][id];
}
function ufPortzentaiak(r) {
  const m = new Map();
  for (const x of r.c) m.set(x[1], (m.get(x[1]) || 0) + (x[3] || 0));
  return m;
}
function ufKonparatu(a, b, p) {
  const A = ufPortzentaiak(a), B = ufPortzentaiak(b);
  const rows = [...new Set([...A.keys(), ...B.keys()])].map(f => [f, A.get(f) || 0, B.get(f) || 0])
    .map(([f, u, fo]) => [f, u, fo, Math.round((u - fo) * 100) / 100]).sort((x, y) => Math.max(y[1], y[2]) - Math.max(x[1], x[2]));
  const total = Math.round(50 * rows.reduce((s, r) => s + Math.abs(r[3]), 0)) / 100;
  return { rows, total, n: a.n || b.n, t: a.t, nm: a.nm, pare: p, partU: a.part, partF: b.part };
}
// Resumen de una zona entera (CAV, Nafarroa, Iparralde) para el panel y el nivel «eh»
const ufZonaCache = {};
function ufZona(z) {
  const p = ufPareak()[z]; if (!p) return null;
  const gakoa = z + ":" + p.join("+"); if (ufZonaCache[gakoa]) return ufZonaCache[gakoa];
  const zatia = (k) => { const d = datuak(k); if (!d) return null;
    if (z === "Iparralde") return d.agg.eh && (d.agg.eh.EH || d.agg.eh.Iparralde);
    const lur = Object.keys(d.agg.territorio).filter(t => LUR_ZONA[t.split("|")[0]] === z).map(t => d.agg.territorio[t]);
    return lur.length ? (lur.length === 1 ? lur[0] : batu(lur)) : null; };
  const a = zatia(p[0]), b = zatia(p[1]); if (!a || !b) return null;
  return (ufZonaCache[gakoa] = ufKonparatu(a, b, p));
}
// Baiona, Angelu y Bokale se comparan como una sola unidad: los cantones (Baiona 1-2-3, Angelu) parten Baiona y Angelu,
// así que el voto cantonal no se puede separar por commune; se suman también sus municipales
const UF_BAB = ["FR64102", "FR64024", "FR64140"];
function ufBatu(rs) {  // suma de municipios: votos por familia (o bloque), participación y censo
  if (rs.some(r => !r)) return null;
  const fam = new Map(); let vc = 0, censo = 0, botoak = 0;
  for (const r of rs) {
    const l = r.c[0];
    vc += l && l[3] ? l[2] * 100 / l[3] : r.c.reduce((s, x) => s + x[2], 0);  // votos a candidaturas del municipio
    censo += r.censo; botoak += (r.part || 0) * r.censo / 100;
    for (const x of r.c) fam.set(x[1], (fam.get(x[1]) || 0) + x[2]);
  }
  const c = [...fam].sort((x, y) => y[1] - x[1]).map(([f, v]) => [f, f, v, vc ? 100 * v / vc : null]);
  return { n: "Baiona-Angelu-Bokale", t: "Lapurdi", censo, part: censo ? 100 * botoak / censo : null, c };
}
function ufRec(level, id) {
  if (level === "eh") {  // Euskal Herria / Hegoalde / Iparralde: suma de las zonas que tienen pareja
    const zk = String(id) === "Iparralde" ? ["Iparralde"] : String(id) === "Hegoalde" ? ["EAE", "Nafarroa"] : UF_ZONAK;
    const zz = zk.map(ufZona).filter(Boolean); if (!zz.length) return null;
    if (zz.length === 1) return zz[0];
    const pareak = ufPareak(), osatu = (i) => batu(zk.filter(z => ufZona(z)).map(z => { const k = pareak[z][i], d = datuak(k);
      return z === "Iparralde" ? d.agg.eh.EH || d.agg.eh.Iparralde : batu(Object.keys(d.agg.territorio).filter(t => LUR_ZONA[t.split("|")[0]] === z).map(t => d.agg.territorio[t])); }));
    return ufKonparatu(osatu(0), osatu(1), null);
  }
  const z = eremuZona(level, id), p = z && ufPareak()[z]; if (!p) return null;
  let a, b;
  if (UF_BAB.includes(String(id))) {  // Baiona-Angelu-Bokale: los tres juntos (los cantones parten Baiona y Angelu)
    a = ufBatu(UF_BAB.map(i => ufLortu("muni", i, p[0]))); b = ufBatu(UF_BAB.map(i => ufLortu("muni", i, p[1])));
  } else { a = ufLortu(level, id, p[0]); b = ufLortu(level, id, p[1]); }
  if (!a || !b) return null;
  if ((ufPortzentaiak(a).get("LOCAL") || 0) >= UF_LOKALA_MAX) return { ezin: true, n: a.n || b.n, t: a.t, pare: p };
  return ufKonparatu(a, b, p);
}
function ufBalioa(u) {
  if (!u || u.ezin) return null;
  if (state.ufAlderdia === "__guztira") return u.total;
  const r = u.rows.find(x => x[0] === state.ufAlderdia);
  return r ? Math.abs(r[3]) : null;
}
function ufTaula(u) {
  return `<div class="cmp"><span class="h">${T.alderdia}</span><span class="h num">${T.udalLabur}</span><span class="h num">${T.foruLabur}</span><span class="h num">Δ</span>` +
    u.rows.filter(r => r[1] >= .3 || r[2] >= .3).map(r => `<span class="nm"><i class="sq" style="background:${FAM[r[0]] || FAM.LOCAL}"></i> ${short(r[0])}</span><span class="num">${pct(r[1])}</span><span class="num">${pct(r[2])}</span><span class="num">${dfmt(r[3])}</span>`).join("") + "</div>";
}
function ufSelektorea() {
  const sel = $("#ufsel"); sel.hidden = state.modua !== "udalforal"; if (sel.hidden) return;
  const fam = new Map();  // familias de todas las zonas que se comparan
  for (const z of UF_ZONAK) for (const r of (ufZona(z) || { rows: [] }).rows) if ((r[1] >= .5 || r[2] >= .5) && !fam.has(r[0])) fam.set(r[0], short(r[0]));
  const opts = [["__guztira", T.guztiraAukera], ...fam];
  if (!opts.some(o => o[0] === state.ufAlderdia)) state.ufAlderdia = "__guztira";
  sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}"${v === state.ufAlderdia ? " selected" : ""}>${l}</option>`).join("");
}


// Capa «Parte-hartzea»: la de los residentes (sin el CERA) en la elección que se ve y en las anteriores de cada zona,
// para el puntero. Cada generación es la elección anterior de cada pieza (Hegoalde y Iparralde votan en fechas distintas).
function partHistoria(level, id, n = 3) {
  const out = [];
  let ks = osagaiak();
  for (let i = 0; i < n + 3 && out.length < n && ks.length; i++) {
    for (const k of ks) {
      const d = datuak(k);
      const r = d && (level === "eh" ? erregistroGordina("eh", id, k) : erregistroDatuetan(d, level, id));
      const p = r && (r.pE ?? r.part);
      if (p != null) { out.push([k, p]); break; }
    }
    ks = [...new Set(ks.map(aurrekoa).filter(Boolean))];
  }
  return out;
}
// ---- colores: se calculan una vez por cambio y viajan dentro del dato ----
const bin = (v, bins) => { if (v == null) return NODATA; for (const [lim, c] of bins) if (v <= lim) return c; return NODATA; };
function color(level, id) {
  if (state.modua === "udalforal") { const v = ufBalioa(ufRec(level, id)); return v == null ? NODATA : bin(v, UF_BINS); }
  const r = erregistroa(level, id);
  if (state.modua === "winner") return r ? FAM[r.gf] || FAM.LOCAL : NODATA;
  if (state.modua === "margin") return r ? (r.m == null ? UNCONTESTED : bin(r.m, MARGIN_BINS)) : NODATA;
  if (state.modua === "turnout") return r ? bin(r.pE ?? r.part, TURNOUT_BINS) : NODATA;  // la de los residentes, sin el CERA
  // konparatu: irabazlea aldatu den ala ez, aukeratutako bi hauteskundeen artean
  const oy = state.konparatu;
  if (!oy) return NODATA;
  const a = erregistroa(level, id, oy), b = r;
  if (a && b) return a.gf === b.gf ? CHANGE.same : CHANGE.flip;
  if (b) return CHANGE.new;
  return NODATA;
}
// ---- eremu bat daturik gabe dagoenean, zergatik: kanpoan / kantoia / muga / iturririk ----
// (kanpoan: hauteskundea ez da hor egin; kantoia: 2011ko departamentaletan kantoien erdiak ez zuen bozkatu;
//  muga: sekzio-mugak aldatu dira eta udalerriak badu daturik; iturririk: iturri ofizialean ez dago emaitzarik)
const LUR_ZONA = { EAE: "EAE", Iparralde: "Iparralde", Araba: "EAE", Bizkaia: "EAE", Gipuzkoa: "EAE", Nafarroa: "Nafarroa", Lapurdi: "Iparralde", "Behe Nafarroa": "Iparralde", Zuberoa: "Iparralde" };
const idZona = (s) => s.startsWith("FR") ? "Iparralde" : s.startsWith("31") ? "Nafarroa" : "EAE";
function eremuZona(level, id) {
  const s = String(id);
  if (level === "eh") return null;
  if (s.includes("|")) return LUR_ZONA[s.split("|")[0]] || null;
  return /^(FR|\d{5})/.test(s) ? idZona(s) : null;
}
const zonakCache = {};
function zonak(k) {  // zonas con datos de la convocatoria y sus complementos
  const kk = [k, ...osagK(k)], clave = kk.join("+");
  if (!zonakCache[clave]) {
    const z = new Map();
    for (const x of kk) { const d = datuak(x); if (d) for (const id of Object.keys(d.muni)) if (!z.has(idZona(id))) z.set(idZona(id), x); }
    if (kk.every(x => datuak(x))) zonakCache[clave] = z; else return z;
  }
  return zonakCache[clave];
}
function hutsunea(level, id, y = state.hauteskundea) {
  if (state.modua === "udalforal") { const u = ufRec(level, id); return u && u.ezin ? "ufezin" : null; }
  if (erregistroa(level, id, y)) return null;
  const z = eremuZona(level, id); if (!z) return null;
  const nork = zonak(y).get(z);
  if (!nork) return "kanpoan";
  if (mota(nork) === "departamentales" && urtea(nork).startsWith("2011")) return "kantoia";
  if (level === "sec" && /^\d{10}$/.test(String(id)) && erregistroa("muni", String(id).slice(0, 5), y)) return "muga";
  return "iturririk";
}
const HUTSA_TESTUA = { kanpoan: T.hutsaKanpoan, kantoia: T.hutsaKantoia, muga: T.hutsaMuga, iturririk: T.hutsaIturririk, ufezin: T.ufEzin };
const sucio = new Set(Object.keys(GEO));
function garbitu(key) {
  if (!sucio.has(key) || !map.getSource(key)) return;
  const fc = GEO[key];
  // nivel "eh": solo el polígono del ámbito de la convocatoria (no pintar Iparralde con datos de Hegoalde)
  const feats = key === "eh" ? fc.features.filter(f => f.id === estaldura()) : fc.features;
  for (const f of feats) {
    f.properties.c = color(key, f.id);
    const z = f.properties.c === NODATA ? hutsunea(key, f.id) : null;  // solo los vacíos: ahorra calcular dos veces
    if (z) f.properties.z = z; else delete f.properties.z;
  }
  // una elección concreta: solo se dibuja el territorio que vota en ella (lo de fuera ni se raya)
  const ikusgai = bakarrikDa() ? feats.filter(f => f.properties.z !== "kanpoan") : feats;
  map.getSource(key).setData({ type: "FeatureCollection", features: ikusgai });
  sucio.delete(key);
}
function zikindu() { Object.keys(GEO).forEach(k => sucio.add(k)); }

// ---- imagen de fondo: Sentinel-2 + ortofotos recortadas por territorio ----
// Cada tesela "orto://z/x/y" se compone aquí: PNOA dentro del contorno de Hegoalde y BD ORTHO dentro del de
// Iparralde; fuera de Euskal Herria queda transparente y se ve el Sentinel-2 de debajo.
const ORTO = [["Hegoalde", IRUDIAK.pnoa], ["Iparralde", IRUDIAK.bdortho]].map(([zona, url]) => {
  const geom = MASKARAK[zona], polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  const pts = polys.flat(2);
  return { url, polys, bbox: [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))] };
});
const lonTile = (x, n) => x / n * 360 - 180;
const latTile = (y, n) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
maplibregl.addProtocol("orto", async (params, abort) => {
  const [z, x, y] = params.url.replace("orto://", "").split("/").map(Number), n = 2 ** z;
  const t = [lonTile(x, n), latTile(y + 1, n), lonTile(x + 1, n), latTile(y, n)];  // oeste, sur, este, norte
  const px = (lon) => ((lon + 180) / 360 * n - x) * 256;
  const py = (lat) => ((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n - y) * 256;
  const lienzo = new OffscreenCanvas(256, 256), ctx = lienzo.getContext("2d");
  for (const o of ORTO) {
    if (t[2] < o.bbox[0] || t[0] > o.bbox[2] || t[3] < o.bbox[1] || t[1] > o.bbox[3]) continue;  // fuera de su zona
    let img;  // si el servidor de ortofotos falla, esa parte se queda con el satélite (sin error en la consola)
    try {
      const r = await fetch(o.url.replace("{z}", z).replace("{x}", x).replace("{y}", y), { signal: abort.signal });
      if (!r.ok) continue;
      img = await createImageBitmap(await r.blob());
    } catch (e) { if (abort.signal.aborted) throw e; continue; }
    const recorte = new Path2D();
    for (const poly of o.polys) for (const anillo of poly) anillo.forEach(([lon, lat], i) => i ? recorte.lineTo(px(lon), py(lat)) : recorte.moveTo(px(lon), py(lat)));
    ctx.save(); ctx.clip(recorte, "evenodd"); ctx.drawImage(img, 0, 0, 256, 256); ctx.restore();
  }
  return { data: await (await lienzo.convertToBlob({ type: "image/png" })).arrayBuffer() };
});

// ---- mapa ----
const sources = {
  sat: { type: "raster", tiles: [IRUDIAK.sentinel], tileSize: 256, maxzoom: IRUDIAK.sentinelMaxZoom, attribution: ATRIB() },
  orto: { type: "raster", tiles: ["orto://{z}/{x}/{y}"], tileSize: 256, minzoom: IRUDIAK.ortoMinZoom, maxzoom: 19 },
};
for (const k in GEO) sources[k] = { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "fid" };
const capas = [{ id: "fondo", type: "background", paint: { "background-color": MAPA_K.fondoa } },
               { id: "sat", type: "raster", source: "sat" },
               { id: "orto", type: "raster", source: "orto", minzoom: IRUDIAK.ortoMinZoom }];
for (const k in GEO) capas.push(
  { id: k + "-fill", type: "fill", source: k, layout: { visibility: "none" },
    paint: { "fill-color": ["coalesce", ["get", "c"], NODATA],
             "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], .85, .62] } },
  // daturik gabeko eremuak, marradunak (zergatia argibidean)
  { id: k + "-hutsa", type: "fill", source: k, layout: { visibility: "none" }, filter: ["has", "z"],
    paint: { "fill-pattern": "marra", "fill-opacity": .9 } },
  { id: k + "-line", type: "line", source: k, layout: { visibility: "none" },
    paint: { "line-color": ["case", ["boolean", ["feature-state", "sel"], false], MAPA_K.nabarmen,
                            ["boolean", ["feature-state", "hover"], false], MAPA_K.nabarmen, MAPA_K.muga],
             "line-width": ["case", ["boolean", ["feature-state", "sel"], false], 2.6,
                            ["boolean", ["feature-state", "hover"], false], 2.2, .7] } });
// Enclaves (Trebiñu, Argantzun y Villaverde Turtzioz): solo en las municipales y las europeas, y solo en el total de
// Euskal Herria (scripts/konfig.py, ENKLABEAK). No están en el polígono de Euskal Herria ni en ningún nivel agregado:
// por encima del nivel municipal se dibujan con esta capa, del color de Euskal Herria en su vista y con su propio
// resultado en las demás; en municipios y secciones son uno más.
const ENKLABEAK = INDEX.enklabeak || [];
sources.enklabeak = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
capas.push({ id: "enklabeak-fill", type: "fill", source: "enklabeak", layout: { visibility: "none" },
  paint: { "fill-color": ["coalesce", ["get", "c"], NODATA], "fill-opacity": .62 } });
// Límites de los niveles superiores, siempre encima aunque el mapa muestre un nivel inferior:
// herrialdes (dorado, más grueso), eskualdeak y, con las secciones, municipios
sources["muga-lur"] = { type: "geojson", data: GEO.territorio };
sources["muga-esk"] = { type: "geojson", data: GEO.eskualdea };  // se rellena al cargar las comarcas
sources["muga-udal"] = { type: "geojson", data: GEO.muni };  // se rellena al cargar los municipios
capas.push(
  { id: "muga-udal", type: "line", source: "muga-udal", minzoom: 11.75, paint: { "line-color": MAPA_K.muga, "line-width": .9, "line-opacity": .8 } },
  { id: "muga-esk", type: "line", source: "muga-esk", minzoom: 9, paint: { "line-color": MAPA_K.mugaEsk, "line-width": ["interpolate", ["linear"], ["zoom"], 9, .9, 13, 1.6], "line-opacity": .55 } },
  { id: "muga-lur", type: "line", source: "muga-lur", minzoom: LUR_MUGA_ZOOM, paint: { "line-color": MAPA_K.mugaLur, "line-width": ["interpolate", ["linear"], ["zoom"], LUR_MUGA_ZOOM, 1.3, 13, 2.6], "line-opacity": .85 } });

const map = new maplibregl.Map({
  container: "map", style: { version: 8, sources, layers: capas },
  center: POS_URL.length === 3 && POS_URL.every(Number.isFinite) ? [POS_URL[0], POS_URL[1]] : MAPA.erdia,
  zoom: POS_URL.length === 3 && Number.isFinite(POS_URL[2]) ? POS_URL[2] : MAPA.zooma, minZoom: MAPA.minZoom, maxZoom: MAPA.maxZoom, attributionControl: false
});
// Para pintar basta con el estilo (capas y fuentes): «load» espera además a todas las teselas de satélite, que pueden
// tardar (o no llegar). Se apunta desde ya: puede ocurrir mientras el arranque espera a los datos (10-abiarazi.js)
let estiloaPrest = false; map.once("style.load", () => { estiloaPrest = true; });
// Móvil: Euskal Herria entera entre la línea de tiempo (arriba) y la hoja de resultados con el dial (abajo)
const MUGIKORRA = matchMedia("(max-width: 900px)");  // móvil y tableta
if (MUGIKORRA.matches && !(POS_URL.length === 3 && POS_URL.every(Number.isFinite)))
  map.fitBounds(MAPA.ehMugak, { padding: { top: 130, bottom: 250, left: 6, right: 6 }, animate: false });
// trama de rayas para los eremuak sin datos (se crea cuando el estilo la pide)
map.on("styleimagemissing", (e) => {
  if (e.id !== "marra" || map.hasImage("marra")) return;
  const n = 8, cv = document.createElement("canvas"); cv.width = cv.height = n;
  const c = cv.getContext("2d"); c.strokeStyle = MAPA_K.marra; c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(0, n); c.lineTo(n, 0); c.moveTo(-n / 2, n / 2); c.lineTo(n / 2, -n / 2); c.moveTo(n / 2, n * 1.5); c.lineTo(n * 1.5, n / 2); c.stroke();
  map.addImage("marra", c.getImageData(0, 0, n, n));
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), "top-right");  // ⓘ: créditos plegados
// empiezan plegados: MapLibre los abre al cargar (es un <details open>)
// MapLibre los vuelve a desplegar cuando cambian los créditos de las capas: plegados hasta que alguien pulse ⓘ
let kredituakIrekita = false;
const kredituakTolestu = () => { const at = document.querySelector(".maplibregl-ctrl-attrib"); if (at && !kredituakIrekita) { at.classList.remove("maplibregl-compact-show"); at.removeAttribute("open"); } };
document.addEventListener("click", (e) => { if (e.target.closest(".maplibregl-ctrl-attrib-button")) kredituakIrekita = true; }, true);
map.on("load", kredituakTolestu); map.on("sourcedata", kredituakTolestu); map.once("idle", kredituakTolestu);
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");  // arriba, junto al menú
map.dragRotate.disable(); map.touchZoomRotate.disableRotation();

// ---- niveles: en automático los gobierna el propio zoom, sin JS por frame ----
function mailaAktiboa() {
  if (state.maila !== "auto") return state.maila;
  const z = map.getZoom();
  for (const [k, lo, hi] of autoMailak()) if (z >= lo && z < hi) return k;
  return "sec";
}
const enklabeakDaude = () => ENKLABEAK.some((i) => erregistroGordina("muni", i, state.hauteskundea));
// Fuera de las municipales y las europeas, los municipios y las secciones de los enclaves no se dibujan
const enklabeakGabe = ["!", ["in", ["slice", ["to-string", ["id"]], 0, 5], ["literal", ENKLABEAK]]];
function enklabeakEzarri() {
  const ikusi = ENKLABEAK.length && enklabeakDaude();
  for (const k of ["muni", "sec"]) {
    map.setFilter(k + "-fill", ikusi ? null : enklabeakGabe); map.setFilter(k + "-line", ikusi ? null : enklabeakGabe);
    map.setFilter(k + "-hutsa", ikusi ? ["has", "z"] : ["all", ["has", "z"], enklabeakGabe]);
  }
  mugakIragazi(ikusi);
  // capa propia por encima del nivel municipal: con poco zoom (vista de Euskal Herria), el color del conjunto
  const a = autoMailak(), eh = a.find((x) => x[0] === "eh"), muni = a.find((x) => x[0] === "muni");
  const goikoa = state.maila === "auto" ? true : !["muni", "sec"].includes(state.maila);
  map.setLayoutProperty("enklabeak-fill", "visibility", ikusi && goikoa && GEO.muni.features.length ? "visible" : "none");
  if (!ikusi || !GEO.muni.features.length) return;
  map.setLayerZoomRange("enklabeak-fill", 0, state.maila === "auto" ? muni[1] : 24);
  const ehKolorea = color("eh", estaldura()), ehBista = state.maila === "eh";
  const fs = GEO.muni.features.filter((f) => ENKLABEAK.includes(String(f.id))).map((f) => ({ ...f,
    properties: { ...f.properties, c: ehBista ? ehKolorea : color("muni", String(f.id)), ceh: ehKolorea } }));
  map.getSource("enklabeak").setData({ type: "FeatureCollection", features: fs });
  // en automático: color de Euskal Herria mientras se ve el nivel «eh», luego el suyo
  map.setPaintProperty("enklabeak-fill", "fill-color", state.maila === "auto" && eh
    ? ["step", ["zoom"], ["coalesce", ["get", "ceh"], NODATA], eh[2], ["coalesce", ["get", "c"], NODATA]] : ["coalesce", ["get", "c"], NODATA]);
}
// Límites que van siempre encima (herrialdes, comarcas, municipios): con una elección concreta, solo los de su territorio
function mugakIragazi(enklabeakIkusi) {
  const z = bakarrikDa() ? zonak(state.hauteskundea) : null;
  const lur = z && Object.keys(LUR_ZONA).filter((t) => z.has(LUR_ZONA[t]));
  map.setFilter("muga-lur", z ? ["in", ["get", "t"], ["literal", lur]] : null);
  map.setFilter("muga-esk", z ? ["in", ["get", "t"], ["literal", lur]] : null);
  const fid = ["to-string", ["get", "fid"]], aurre = ["slice", fid, 0, 2];
  const udalZona = { Nafarroa: ["==", aurre, "31"], Iparralde: ["==", aurre, "FR"], EAE: ["all", ["!=", aurre, "31"], ["!=", aurre, "FR"]] };
  const iragazkiak = [];
  if (!enklabeakIkusi) iragazkiak.push(["!", ["in", ["slice", fid, 0, 5], ["literal", ENKLABEAK]]]);
  if (z) iragazkiak.push(["any", ...[...z.keys()].filter((x) => udalZona[x]).map((x) => udalZona[x])]);
  map.setFilter("muga-udal", iragazkiak.length ? ["all", ...iragazkiak] : null);
}
// Capas, filtros y feature-state solo con el estilo cargado: antes MapLibre lanza «Style is not done loading»
// (móvil lento, pestaña en segundo plano, datos ya en caché). arrancar() (10-abiarazi.js) lo aplica todo al cargar.
function ezarriMaila() {
  if (!estiloaPrest) return;
  enklabeakEzarri();
  for (const k in GEO) {
    const vis = state.maila === "auto" ? autoMailak().some(a => a[0] === k) : k === state.maila;
    for (const suf of ["-fill", "-hutsa", "-line"]) {
      map.setLayoutProperty(k + suf, "visibility", vis ? "visible" : "none");
      if (vis) {
        const a = state.maila === "auto" ? autoMailak().find(x => x[0] === k) : null;
        map.setLayerZoomRange(k + suf, a ? a[1] : 0, a ? a[2] : 24);
      }
    }
    if (vis) garbitu(k);
  }
}

// ---- resaltado y selección con feature-state: toca una feature, no la capa ----
let hov = null, sel = null;
const capasFill = Object.keys(GEO).map(k => k + "-fill");
function markatu(ref, prop, on) { if (ref && estiloaPrest) map.setFeatureState(ref, { [prop]: on }); }
// Pantallas táctiles: el toque también lanza «mousemove», pero ahí ni se ve el tooltip ni hay hover: se salta (INP)
const UKIMENA = matchMedia("(hover: none)");
map.on("mousemove", capasFill, (e) => {
  if (UKIMENA.matches) return;
  const f = e.features && e.features[0]; if (!f) return;
  if (!hov || hov.id !== f.id || hov.source !== f.source) { markatu(hov, "hover", false); hov = { source: f.source, id: f.id }; markatu(hov, "hover", true); }
  const t = $("#tip"); t.innerHTML = argibidea(String(f.id)); t.dataset.on = "1";
  // con transform y no con left/top: moverlo no cuenta como desplazamiento de la página (CLS)
  t.style.transform = `translate(${e.point.x}px, ${e.point.y + 64}px) translate(-50%, -100%)`;
  map.getCanvas().style.cursor = "pointer";
});
map.on("mouseleave", capasFill, () => { markatu(hov, "hover", false); hov = null; $("#tip").removeAttribute("data-on"); map.getCanvas().style.cursor = ""; });
// ---- etiquetas en euskera: herrialdes con el mapa alejado; municipios por población según el zoom ----
const capaIzenak = document.createElement("div"); capaIzenak.id = "izenak"; map.getContainer().appendChild(capaIzenak);
// Una capa de nombres por nivel, la misma que se ve en el mapa: el ámbito entero ("eh"), herrialdes,
// eskualdeak y, desde el nivel municipal, los municipios por población sin que se pisen
let pintando = false;
function pintarIzenak() {
  pintando = false;
  const W = capaIzenak.clientWidth, H = capaIzenak.clientHeight, html = [];
  // zonas tapadas por los paneles y el menú radial: ahí no se ponen etiquetas
  const base = capaIzenak.getBoundingClientRect();
  const puestas = ["#denboralerroa:not([hidden])", "#rail", "#hud", "#dial .kat", "#dial .ring.on", ".maplibregl-ctrl-group", ".maplibregl-ctrl-attrib"].flatMap(sel => [...document.querySelectorAll(sel)])
    .map(e => e.getBoundingClientRect()).filter(r => r.width && r.height)
    .map(r => [r.left - base.left, r.top - base.top, r.right - base.left, r.bottom - base.top]);
  const libre = (x, y, w, h) => { const b = [x - w / 2 - 4, y - h / 2 - 2, x + w / 2 + 4, y + h / 2 + 2];
    if (b[0] < 0 || b[1] < 0 || b[2] > W || b[3] > H || puestas.some(p => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1])) return false;
    puestas.push(b); return true; };
  const poner = (n, lon, lat, cls, pxLetra, espacio) => {  // ancho aproximado según letra y espaciado
    const p = map.project([lon, lat]), w = n.length * (pxLetra * 0.56 + espacio) + 6;
    if (libre(p.x, p.y, w, pxLetra + 4)) html.push(`<span class="${cls}" style="left:${p.x}px;top:${p.y}px">${esc(n)}</span>`);
  };
  const nivel = mailaAktiboa();
  const zz = bakarrikDa() ? zonak(state.hauteskundea) : null;  // una elección concreta: solo los nombres de su territorio
  if (nivel === "eh") { const e = IZENAK.eh[estaldura()]; if (e) poner(e[0], e[1], e[2], "eh", 17, 7); }
  else if (nivel === "eremua") (IZENAK.eremuak || []).forEach(([n, lon, lat]) => { if (!zz || zz.has(n)) poner(eremuIzena(n), lon, lat, "lur", 10.5, 3.2); });
  else if (nivel === "territorio") IZENAK.lurraldeak.forEach(([n, lon, lat]) => { if (!zz || zz.has(LUR_ZONA[n])) poner(lurIzena(n), lon, lat, "lur", 10.5, 3.2); });
  else if (nivel === "eskualdea") IZENAK.eskualdeak.forEach(([n, lon, lat]) => poner(n, lon, lat, "esk", 9.5, 1.5));
  else for (const [i, n, lon, lat, pob] of IZENAK.herriak) {  // ya vienen ordenados por población
    if (ENKLABEAK.includes(i) && !enklabeakDaude()) continue;  // enclaves: solo en las municipales y las europeas
    if (zz && !zz.has(idZona(i))) continue;
    const hiri = pob >= 20000; poner(n, lon, lat, hiri ? "hiri" : "", hiri ? 12 : 11, .3);
  }
  capaIzenak.innerHTML = html.join("");
}
const izenakBerritu = () => { if (!pintando) { pintando = true; requestAnimationFrame(pintarIzenak); } };
map.on("move", izenakBerritu); map.on("resize", izenakBerritu); map.on("load", izenakBerritu);
izenakBerritu();

map.on("click", capasFill, (e) => { const f = e.features && e.features[0]; if (!f) return;
  if (f.source === "eh") { map.easeTo({ center: e.lngLat, zoom: 8.15, duration: 500 }); return; }  // desagregar: CAV, Nafarroa, Iparralde
  hautatu(String(f.id) === state.hautatua ? null : String(f.id), f.source, true); });
map.on("click", (e) => { if (!map.queryRenderedFeatures(e.point, { layers: capasFill }).length) hautatu(null, undefined, true); });
// gero: desde el mapa, primero se ve el municipio resaltado y el panel se rehace en el fotograma siguiente (INP)
function hautatu(id, src, gero = false) {
  markatu(sel, "sel", false); sel = null; state.hautatua = id;
  if (id) { sel = { source: src || mailaAktiboa(), id }; markatu(sel, "sel", true); }
  if (gero) arnasa().then(() => { if (state.hautatua === id) margotu(); }); else margotu();
}
map.on("moveend", () => urlaIdatzi());
// ---- textos del panel (idénticos a la versión anterior) ----
// Con qué se comparan las flechas (texto del panel)
const aldera = () => state.modua === "compare" ? (state.konparatu !== state.hauteskundea ? izena(state.konparatu) : "")
  : aurrekoak().length < osagaiak().length ? "" : aurrekoak().map(x => `${ZONA_LABUR[eremua(x)] && osagaiak().length > 1 ? ZONA_LABUR[eremua(x)] + " " : ""}${izena(x)}`).join(" + ");
function delta(id, c, level) {
  const pr = aurrekoErregistroa(level || mailaAktiboa(), level === "eh" ? estaldura() : id); if (!pr) return null;
  const m = c[1] === "LOCAL" ? pr.c.find(x => x[0] === c[0]) : pr.c.find(x => x[1] === c[1]);
  return m && m[3] != null && c[3] != null ? Math.round((c[3] - m[3]) * 10) / 10 : null;
}
function argibidea(id) {
  if (state.modua === "udalforal") {
    const u = ufRec(mailaAktiboa(), id), name = NAME[id] || id;
    if (!u) return `<div class="tt-name">${name}</div><div class="tt-muted">${T.ufDaturikEzTip}</div>`;
    if (u.ezin) return `<div class="tt-name">${esc(u.n) || name}</div><div class="tt-huts">${T.ufEzin}</div>`;
    const rows = u.rows.slice(0, 4).map(r => `<div class="tt-row"><span><i class="sq" style="background:${FAM[r[0]] || FAM.LOCAL}"></i> ${short(r[0])}</span><span>${pct(r[1])} / ${pct(r[2])} ${dfmt(r[3])}</span></div>`).join("");
    return `<div class="tt-name">${esc(u.n) || name}</div><div class="tt-muted">${T.ufIzenburua}: ${pct(u.total)} · ${T.udalLabur} / ${T.foruLabur} / Δ</div>${rows}`;
  }
  const r = erreg(id), name = NAME[id] || id;
  const batera = sekzioBatera(id);
  if (!r) { const z = hutsunea(mailaAktiboa(), id); return `<div class="tt-name">${name}</div><div class="tt-muted">${T.daturikEz} · ${izena(state.hauteskundea)}</div>${z ? `<div class="tt-huts">${HUTSA_TESTUA[z]}</div>` : ""}`; }
  // solo quien opta a gobernar: a LEHIA_MARJINA puntos o menos del primero
  const lehen = r.c[0] && r.c[0][3], lehiakideak = r.c.filter(c => c[3] != null && lehen != null && c[3] >= lehen - LEHIA_MARJINA);
  // en la capa «Parte-hartzea», en vez de las candidaturas: la de los residentes en esta elección y en las anteriores
  const part = state.modua === "turnout" ? partHistoria(mailaAktiboa(), id) : null;
  const rows = part
    ? `<div class="tt-muted">${T.egoiliarPartehartzea}</div>` +
      part.map(([k, p]) => `<div class="tt-row"><span>${izena(k)}</span><span>${pct(p)}</span></div>`).join("")
    : lehiakideak.map(c => `<div class="tt-row"><span><i class="sq" style="background:${FAM[c[1]] || FAM.LOCAL}"></i> ${short(c[0])}</span><span>${pct(c[3])} ${dfmt(delta(id, c))}</span></div>`).join("");
  return `<div class="tt-name">${esc(eremuIzena(r.n)) || name}</div><div class="tt-muted">${esc(eremuIzena(r.t || ""))}${r.nm ? ` · ${r.nm} ${T.udalerri}` : ""}${part ? "" : ` · ${T.partehartzea} ${partTestua(r)}`}</div>${rows}${batera ? `<div class="tt-huts">${T.sekzioBatera} ${batera}</div>` : ""}`;
}
// Puntero: participación con el voto exterior (CERA, territorios y total) y, entre paréntesis, la de los residentes (la del mapa)
const partTestua = (r) => `${pct(r.part)}${r.pE != null ? ` (${T.egoiliarrak} ${pct(r.pE)})` : ""}`;
// Recuadro de la participación: la oficial y, con voto exterior, debajo y con su propia cifra, la de los residentes (la
// del mapa). ▲▼ con la misma base: la oficial solo frente a otra oficial; la de residentes, siempre
const aldea = (x, y) => x != null && y != null ? dfmt(Math.round((x - y) * 10) / 10) : "";
function partKpi(r, a) {
  const egoiliar = (x) => x && (x.pE ?? x.part);
  const d = !a ? "" : r.pE != null ? (a.pE != null ? aldea(r.part, a.part) : "") : aldea(r.part, egoiliar(a));
  return `<div class="kpi"><div class="v">${pct(r.part)} ${d}</div><div class="k">${T.partehartzea}</div>` +
    (r.pE != null ? `<div class="v v2">${pct(r.pE)} ${a ? aldea(r.pE, egoiliar(a)) : ""}</div><div class="k">${T.egoiliarrak}</div>` : "") + "</div>";
}
function legenda() { return legendaModua() + `<div class="legend"><div class="li"><i class="sq marra"></i>${T.hutsaLegenda}</div></div>`; }
function legendaModua() {
  if (state.modua === "udalforal") return `<div class="lbl">${T.ufIzenburua} (${state.ufAlderdia === "__guztira" ? T.botoAldaketaOsoa : short(state.ufAlderdia)})</div><div class="legend">${[`0 – 2 ${T.puntu}`,"2 – 4","4 – 6","6 – 8","> 8"].map((l,i)=>`<div class="li"><i class="sq" style="background:${UF_BINS[i][1]}"></i>${l}</div>`).join("")}</div>
    <p class="hint">${T.ufAzalpena}</p>`;
  if (state.modua === "winner") return `<p class="hint">${T.koloreaIrabazlea} ${T.ikuspegiaAzalpena} ${lokalak()} ${T.grisez}.</p>`;
  if (state.modua === "margin") return `<div class="lbl">${T.marjinaLegenda}</div><div class="legend">${[`≤ 2 ${T.puntu}`,"2 – 5","5 – 10","10 – 20","> 20"].map((l,i)=>`<div class="li"><i class="sq" style="background:${MARGIN_BINS[i][1]}"></i>${l}</div>`).join("")}<div class="li"><i class="sq" style="background:${UNCONTESTED}"></i>${T.hautagaitzaBakarra}</div></div>`;
  if (state.modua === "turnout") return `<div class="lbl">${T.partehartzeaIzenb}</div><div class="legend">${["≤ 50 %","50 – 58 %","58 – 66 %","66 – 74 %","> 74 %"].map((l,i)=>`<div class="li"><i class="sq" style="background:${TURNOUT_BINS[i][1]}"></i>${l}</div>`).join("")}</div>`;
  const oy = state.konparatu;  // konparatu modua
  return `<div class="lbl">${T.irabazleAldaketa} ${izena(oy)} → ${izena(state.hauteskundea)}</div><div class="legend"><div class="li"><i class="sq" style="background:${CHANGE.flip}"></i>${T.irabazleaAldatu}</div><div class="li"><i class="sq" style="background:${CHANGE.same}"></i>${T.irabazleBera}</div><div class="li"><i class="sq" style="background:${CHANGE.new}"></i>Daturik ez ${oy || "–"}an</div></div>`;
}
function laburpena() {
  const d = datuak(); if (!d) return "";
  if (state.modua === "udalforal") {  // un bloque por zona: CAV, Nafarroa, Iparralde (cada una con su elección «foral»)
    const zonak = UF_ZONAK.map(z => [z, ufZona(z)]).filter(([, u]) => u);
    if (!zonak.length) return `<div class="hdr"><div><h2>${T.ufIzenburua}</h2><div class="meta">${izena(state.hauteskundea)}</div></div></div>
      <p class="hint">${T.ufAzalpenaEz}</p>${legenda()}`;
    return `<div class="hdr"><div><h2>${T.ufIzenburua}</h2><div class="meta">${zonak.map(([z]) => T.zonaLabur[z] || z).join(" · ")}</div></div></div>` +
      zonak.map(([z, u]) => `<div class="rule"></div><div class="lbl">${T.zonaLabur[z] || z} · ${izena(u.pare[0])} ↔ ${izena(u.pare[1])}</div>
      <div class="kpis"><div class="kpi"><div class="v">${pct(u.total)}</div><div class="k">${T.aldeaGuztira}</div></div><div class="kpi"><div class="v">${pct(u.partU)}</div><div class="k">${T.parteUdal}</div></div><div class="kpi"><div class="v">${pct(u.partF)}</div><div class="k">${T.parteForu}</div></div></div>
      ${ufTaula(u)}`).join("") + legenda();
  }
  const eh = erregistroa("eh", estaldura()), ehAur = aurrekoErregistroa("eh", estaldura());
  const filas = eh.c.slice(0, 8).map(c => `<div class="row"><span class="nm"><i class="sq" style="background:${FAM[c[0]] || FAM.LOCAL}"></i>${short(c[0])}</span><span class="val"><span class="botoak">${fmt(c[2])}</span> ${pct(c[3])} ${dfmt(delta("EH", c, "eh"))}</span></div><div class="bar"><i style="width:${Math.min(100, c[3] || 0)}%;background:${FAM[c[0]] || FAM.LOCAL}"></i></div>`).join("");
  const bozkatzaileak = eh.part != null && eh.censo ? Math.round(eh.part * eh.censo / 100) : null;  // baliozkoak + zuriak + baliogabeak
  // todos los colores que aparecen en el mapa (hace de legenda del modo Irabazlea)
  const won = Object.entries(eh.won).sort((a,b)=>b[1]-a[1]).map(([f,n])=>`<div class="legend"><div class="li"><i class="sq" style="background:${FAM[f] || FAM.LOCAL}"></i>${short(f)}<span class="cnt">${n}${ehAur && ehAur.won ? " " + dsfmt(n - (ehAur.won[f] || 0)) : ""}</span></div></div>`).join("");
  // una elección concreta de solo la CAV o solo Nafarroa: ese es el ámbito (los datos traen «Hegoalde»)
  const bakarEremua = bakarrikDa() && ["EAE", "Nafarroa"].includes(eremua(state.hauteskundea)) ? eremua(state.hauteskundea) : null;
  const izenburua = bakarEremua ? eremuIzena(bakarEremua) : eh.n;
  return `<div class="hdr"><div><h2>${esc(izenburua)}</h2><div class="meta">${T.motaLuzea[mota(state.hauteskundea)] || T.kat[state.mapa]} · ${zona(state.hauteskundea) === "Azkenak" ? izena(state.hauteskundea).replace(/^[^:]*: /, "") : urtea(state.hauteskundea)}${osag().izena ? ` + ${osag().izena}` : ""} · ${eh.nm} ${T.udalerri}</div></div></div>
    <div class="kpis lau">${partKpi(eh, ehAur)}<div class="kpi"><div class="v">${fmt(bozkatzaileak)}</div><div class="k">${T.bozkatzaileak}</div></div><div class="kpi"><div class="v">${fmt(eh.censo)}</div><div class="k">${T.errolda}</div></div><div class="kpi"><div class="v">${eh.esc ? fmt(eh.esc) : "–"}</div><div class="k">${mota(state.hauteskundea) === "municipales" ? T.zinegotzi : T.eserleku}</div></div></div>
    <div class="lbl">${ikuspegia("eh", estaldura()) === "blokeak" ? T.botoakBlokeka : T.botoakAlderdika} · ${fmt(eh.vc)} ${T.hautagaitzenBotoak}${aldera() ? ` · Δ ${aldera()}` : ""}</div>${filas}
    <div class="lbl">${T.irabazitakoUdalerriak}${state.modua === "winner" ? ` · ${T.mapakoKoloreak}` : ""}</div>${won}${ceraZatia("eh", estaldura(), eh)}${legenda()}`;
}
// Barrutiak de Iparralde: las candidaturas por su nombre y, en una zona con varios cantones, cada cantón oficial
function ipaBarrutiak(id) {
  const l = mailaAktiboa(); if (!["legegile_barrutia", "kantonamendua"].includes(l)) return "";
  const raw = erregistroGordina(l, id), lerroa = (c) => `<div class="row"><span class="nm"><i class="sq" style="background:${FAM[c[1]] || FAM.LOCAL}"></i>${esc(c[0])}</span><span class="val">${pct(c[3])}</span></div>`;
  let html = raw && raw.h ? `<div class="lbl">${T.hautagaiak}</div>${raw.h.map(lerroa).join("")}` : "";
  const kk = [state.hauteskundea, ...osagK()].map(datuak).filter(d => d && d.agg.kantonamendu_ofiziala);
  const izen = String(id).split("|")[1];
  for (const d of kk) {
    const ofizialak = Object.values(d.agg.kantonamendu_ofiziala).filter(k => k.taldea === izen);
    if (ofizialak.length > 1) html += `<div class="lbl">${T.kantonamenduOfizialak}</div><p class="hint">${T.kantonamenduAzalpena}</p>` +
      ofizialak.map(k => `<div class="kanton"><b>${esc(k.n)}</b> <span class="meta">${pct(k.part)} ${T.partehartzea}</span>${k.c.slice(0, 3).map(lerroa).join("")}</div>`).join("");
  }
  return html;
}
// Voto exterior (CERA): ya sumado en los territorios y en el total (no en municipios, secciones ni comarcas); aquí, su
// desglose: la elección elegida y sus complementos (cada territorio, del primero que lo trae); nada en las que no lo publican
function ceraErregistroa(level, id) {
  if (state.modua === "udalforal") return null;
  const k = state.hauteskundea, ds = [k, ...osagK(k)].map(datuak).filter(d => d && d.cera);
  if (level === "territorio") { const n = String(id).split("|")[1]; for (const d of ds) if (d.cera[n]) return d.cera[n]; return null; }
  if (level !== "eh" && level !== "eremua") return null;
  const t = {};  // cada territorio, del primero que lo trae; en «eremua», solo los suyos (la CAV: Araba, Bizkaia y Gipuzkoa)
  ds.forEach(d => Object.entries(d.cera).forEach(([n, r]) => { if (!t[n] && (level === "eh" || LUR_ZONA[n] === String(id).split("|")[0])) t[n] = r; }));
  const rs = Object.values(t); if (!rs.length) return null;
  if (rs.length === 1) return rs[0];
  const S = (f) => rs.reduce((a, r) => a + (f(r) || 0), 0);
  const censo = rs.every(r => r.censo != null) ? S(r => r.censo) : null, bozk = S(r => r.bozk), vc = S(r => r.vc);
  const v = new Map();
  rs.forEach(r => r.c.forEach(c => { const x = v.get(c[0]); if (x) x[2] += c[2]; else v.set(c[0], [c[0], c[1], c[2]]); }));
  const c = [...v.values()].sort((a, b) => b[2] - a[2]).map(x => [x[0], x[1], x[2], vc ? Math.round(10000 * x[2] / vc) / 100 : null]);
  return { censo, bozk, vc, zb: S(r => r.zb), part: censo ? Math.round(10000 * bozk / censo) / 100 : null, c };
}
function ceraZatia(level, id, r) {
  const c = ceraErregistroa(level, id); if (!c || !r) return "";
  const filas = c.c.slice(0, 5).map(x => `<div class="row"><span class="nm"><i class="sq" style="background:${FAM[x[1]] || FAM.LOCAL}"></i>${esc(x[0])}</span><span class="val">${fmt(x[2])} · ${pct(x[3])}</span></div>`).join("");
  return `<div class="rule"></div><div class="lbl">${T.ceraLbl}${level === "eh" && estaldura() === "EH" ? " · Hegoalde" : ""}</div>
    <div class="kpis"><div class="kpi"><div class="v">${fmt(c.bozk)}</div><div class="k">${T.bozkatzaileak}</div></div><div class="kpi"><div class="v">${pct(c.part)}</div><div class="k">${T.partehartzea}</div></div><div class="kpi"><div class="v">${fmt(c.censo)}</div><div class="k">${T.errolda}</div></div></div>
    ${filas}<p class="hint">${T.ceraBarne}</p>`;
}
function xehetasuna(id) {
  const r = erreg(id), name = NAME[id] || id, agg = !!(r && r.nm);
  const cierre = `<button class="close" aria-label="${T.itxi}" id="closebtn">×</button>`;
  if (state.modua === "udalforal") {
    const u = ufRec(mailaAktiboa(), id);
    if (!u) return `<div class="hdr"><div><h2>${name}</h2><div class="meta">${T.ufDaturikEz}</div></div>${cierre}</div>`;
    const bikotea = u.pare ? `${izena(u.pare[0])} ↔ ${izena(u.pare[1])}` : T.ufIzenburua;
    if (u.ezin) return `<div class="hdr"><div><h2>${esc(u.n) || name}</h2><div class="meta">${bikotea}</div></div>${cierre}</div><p class="hint">${T.ufEzin}</p>`;
    return `<div class="hdr"><div><h2>${esc(u.n) || name}</h2><div class="meta">${bikotea}${u.t ? " · " + u.t : ""}</div></div>${cierre}</div>
      <div class="kpis"><div class="kpi"><div class="v">${pct(u.total)}</div><div class="k">${T.aldeaGuztira}</div></div><div class="kpi"><div class="v">${pct(u.partU)}</div><div class="k">${T.parteUdal}</div></div><div class="kpi"><div class="v">${pct(u.partF)}</div><div class="k">${T.parteForu}</div></div></div><div class="rule"></div>${ufTaula(u)}`;
  }
  if (!r) {
    const z = hutsunea(mailaAktiboa(), id), muni = z === "muga" ? String(id).slice(0, 5) : null;
    return `<div class="hdr"><div><h2>${name}</h2><div class="meta">${T.daturikEz} · ${izena(state.hauteskundea)}</div></div>${cierre}</div>
      ${z ? `<p class="hint">${HUTSA_TESTUA[z]}${muni ? `: <button class="lotura" id="munira">${esc(MUNIS[muni] ? MUNIS[muni].n : muni)}</button>` : ""}.</p>` : ""}`;
  }
  const oy = state.modua === "compare" ? state.konparatu : aurrekoa(state.hauteskundea);
  const esSec = String(id).length === 10 && mailaAktiboa() === "sec";
  const pr0 = aurrekoErregistroa(mailaAktiboa(), id);  // para la variación de la participación
  const titulo = esc(esSec ? MUNIS[String(id).slice(0,5)].n : (eremuIzena(r.n) || name));
  const sub = esSec ? `${NAME[id].split(" · ")[1]}. ${T.sekzioa} · ${T.errolda} ${fmt(r.censo)}`
            : agg ? `${esc(eremuIzena(r.t))} · ${r.nm} ${T.udalerri} · ${fmt(r.pob)} ${T.biztLabur}`
            : `${esc(lurIzena(r.t))} · ${fmt(r.pob)} ${T.biztanle} · ${r.esc ?? "–"} ${mota(state.hauteskundea) === "municipales" ? T.zinegotzi : T.eserleku} · ${String(id).startsWith("FR") ? `INSEE ${String(id).slice(2)}` : `INE ${id}`}`;
  let tabla;
  if (state.modua === "compare" && oy !== state.hauteskundea) {
    const pr = erreg(id, oy) || { c: [] };
    const keys = [...new Map([...r.c, ...pr.c].map(c => [c[1] === "LOCAL" ? c[0] : c[1], c])).values()];
    tabla = `<div class="cmp"><span class="h">${T.hautagaitza}</span><span class="h num">${urtea(oy)}</span><span class="h num">${urtea(state.hauteskundea)}</span><span class="h num">Δ</span>` +
      keys.map(c => { const a = c[1]==="LOCAL" ? pr.c.find(x=>x[0]===c[0]) : pr.c.find(x=>x[1]===c[1]); const b = c[1]==="LOCAL" ? r.c.find(x=>x[0]===c[0]) : r.c.find(x=>x[1]===c[1]);
        return `<span class="nm"><i class="sq" style="background:${FAM[c[1]] || FAM.LOCAL}"></i> ${short(c[1]==="LOCAL"?c[0]:c[1])}</span><span class="num">${a?pct(a[3]):"–"}</span><span class="num">${b?pct(b[3]):"–"}</span><span class="num">${a&&b&&a[3]!=null&&b[3]!=null?dfmt(Math.round((b[3]-a[3])*10)/10):"–"}</span>`; }).join("") + `</div>`;
  } else {
    tabla = r.c.map(c => `<div class="row"><span class="nm"><i class="sq" style="background:${FAM[c[1]] || FAM.LOCAL}"></i>${short(c[0])}</span><span class="val">${fmt(c[2])} · ${pct(c[3])} ${dfmt(delta(id, c))}${!agg && !esSec && mota(state.hauteskundea) === "municipales" ? ` · ${c[4]} z.` : ""}</span></div><div class="bar"><i style="width:${Math.min(100, c[3] || 0)}%;background:${FAM[c[1]] || FAM.LOCAL}"></i></div>`).join("");
  }
  return `<div class="hdr"><div><h2>${titulo}</h2><div class="meta">${sub}</div></div>${cierre}</div>
    <div class="kpis">${partKpi(r, pr0)}<div class="kpi"><div class="v">${fmt(r.censo)}</div><div class="k">${T.errolda}</div></div><div class="kpi"><div class="v">${pct(r.m)}</div><div class="k">${T.aldea12}</div></div></div>
    ${(r.m != null && r.m <= 10) || r.la ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${r.m != null && r.m <= 10 ? `<span class="badge">${T.lehian}</span>` : ""}${r.la ? `<span class="badge">${T.zerrendaIrekiak}</span>` : ""}</div>` : ""}
    <div class="rule"></div>${tabla}${ipaBarrutiak(id)}
    ${agg ? `<p class="hint">${T.aggOharra}</p>${ceraZatia(mailaAktiboa(), id, r)}` : ""}`;
}
function ogiApurrak() {
  const partes = [["Euskal Herria", () => { state.maila = "auto"; $("#level").value = "auto"; ezarriMaila(); map.fitBounds(MAPA.ehMugak, { padding: encuadre(), duration: 600 }); hautatu(null); }]];
  const id = state.hautatua;
  // sobre cada herrialde, su bloque (la CAV o Iparralde; Nafarroa es a la vez bloque y herrialde)
  const eremuApurra = (t) => { const z = LUR_ZONA[t]; return z && z !== t ? [[eremuIzena(z), () => joan("eremua", `${z}|${z}`)]] : []; };
  if (id) {
    if (id.includes("|")) {
      const [t, n] = id.split("|"), l = mailaAktiboa();
      if (l !== "eremua" && t !== "Euskal Herria") {  // «Euskal Herria|…» (zonas del euskera): ya es la primera
        partes.push(...eremuApurra(t));
        // «Iparralde|…» (circunscripciones y cantones): su bloque; el resto, su herrialde
        if (l !== "territorio") partes.push([lurIzena(t), LUR_ZONA[t] === t && t !== "Nafarroa" ? () => joan("eremua", `${t}|${t}`) : () => joan("territorio", `${t}|${t}`)]);
      }
      partes.push([eremuIzena(n), null]);
    } else {
      // municipio del eremu: Hegoalde "48020" / sección "4802001001"; Iparralde "FR64102" / bureau "FR64102-0001"
      const s = String(id), ine = s.startsWith("FR") ? s.split("-")[0] : s.slice(0, 5), m = MUNIS[ine], esSekzioa = s.length === 10 || s.includes("-");
      if (m) {
        partes.push(...eremuApurra(m.t));
        partes.push([lurIzena(m.t), () => joan("territorio", `${m.t}|${m.t}`)]);
        if (m.e) partes.push([m.e, () => joan("eskualdea", `${m.t}|${m.e}`)]);
        if (esSekzioa) { partes.push([m.n, () => joan("muni", ine)]); partes.push([((NAME[id] || "").split(" · ")[1] || s.split("-")[1] || "") + `. ${T.sekzioa}`, null]); }
        else partes.push([m.n, null]);
      }
    }
  }
  $("#crumb").innerHTML = partes.map((p, i) => `${i ? '<span class="sep">›</span>' : ""}${p[1] ? `<button>${esc(p[0])}</button>` : `<span class="cur">${esc(p[0])}</span>`}`).join("");
  [...$("#crumb").querySelectorAll("button")].forEach((b, i) => b.addEventListener("click", partes.filter(p => p[1])[i][1]));
}
function encuadre() { const menua = window.innerWidth > 900 && !$("#app").classList.contains("menurik-ez");
  return { top: 90, bottom: 40, left: menua ? 290 : 20, right: window.innerWidth > 900 ? 440 : 20 }; }
function bbox(f) {
  if (f.properties.bb) { const b = f.properties.bb; return [[b[0], b[1]], [b[2], b[3]]]; }
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  (function w(c) { if (typeof c[0] === "number") { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); } else c.forEach(w); })(f.geometry.coordinates);
  return [[x0, y0], [x1, y1]];
}
async function joan(level, id) {
  await mailaKargatu(level);
  state.maila = level; $("#level").value = level; ezarriMaila();
  const f = GEO[level].features.find(x => String(x.id) === String(id));
  hautatu(id, level);
  if (f) map.fitBounds(bbox(f), { padding: encuadre(), maxZoom: 12.5, duration: 700 });
}
function margotu() { if (typeof izenakBerritu === "function") izenakBerritu(); ufSelektorea(); urlaIdatzi(); $("#body").innerHTML = state.fitxa === "eserlekuak" ? eserlekuakOrria() : state.fitxa === "bilakaera" ? bilakaeraOrria() : state.hautatua ? xehetasuna(state.hautatua) : laburpena(); const c = $("#closebtn"); if (c) c.addEventListener("click", () => hautatu(null));
  const mu = $("#munira"); if (mu) mu.addEventListener("click", () => joan("muni", String(state.hautatua).slice(0, 5))); ogiApurrak(); }
// ---- controles ----
// Desplegable de convocatorias de la categoría, agrupadas por zona (las más recientes primero)
function selectorConvocatoria(valor, alCambiar, etiqueta) {
  const sel = document.createElement("select"); sel.className = "sel"; sel.setAttribute("aria-label", etiqueta);
  for (const z of ["Azkenak", "Euskal Herria", "Hegoalde", "Iparralde"]) {
    const ks = hauteskundeak().filter(k => zona(k) === z).reverse(); if (!ks.length) continue;
    const g = document.createElement("optgroup"); g.label = T.zonak[z] || z;
    for (const k of ks) { const o = document.createElement("option"); o.value = k; o.textContent = izena(k); g.appendChild(o); }
    sel.appendChild(g);
  }
  sel.value = valor; sel.addEventListener("change", () => alCambiar(sel.value));
  return sel;
}
// La elección se elige en el semicírculo y en la línea de tiempo; arriba solo queda, en «Konparatu», con cuál comparar
function hautatzaileakMargotu() {
  const box = $("#years"); box.innerHTML = ""; box.hidden = state.modua !== "compare";
  if (state.modua === "compare") {
    const s = document.createElement("span"); s.className = "chip"; s.style.borderColor = "transparent"; s.textContent = T.vs; box.appendChild(s);
    box.appendChild(selectorConvocatoria(state.konparatu, async (k) => { state.konparatu = k; await prestatu(); zikindu(); ezarriMaila(); margotu(); }, T.konparatzekoa));
  }
  pintarDial(); lerroaMargotu();
}
async function aldatuHauteskundea(k) {
  // se queda en la categoría actual si la incluye (el Parlamento de Navarra está en Autonomikoak y en Foralak)
  const kat = INDEX.kategoriak[state.mapa].includes(k) ? state.mapa : Object.keys(INDEX.kategoriak).find(t => INDEX.kategoriak[t].includes(k));
  // una elección concreta: solo ella y su territorio (sin las de otras zonas); la línea de tiempo, en su fecha.
  // «Azkenak» (el anillo o «Gaur»): las últimas de cada zona
  state.bakarrik = zona(k) !== "Azkenak";
  state.denboraT = state.bakarrik ? dataZ(k) : null;
  if (kat !== state.mapa) { state.mapa = kat; state.konparatu = aurrekoa(k) || k; }
  else if (state.modua === "compare" && k !== state.hauteskundea) state.konparatu = state.hauteskundea;
  state.hauteskundea = k;
  hautatzaileakMargotu(); await arnasa();  // primero el dial y la línea de tiempo; luego el mapa y el panel
  await prestatu(); hautatu(null); zikindu(); ezarriMaila(); hautatzaileakMargotu(); margotu();
}
async function aldatuMapa(t) {
  state.mapa = t; state.denboraT = null; state.bakarrik = false; state.hauteskundea = azkena(); state.konparatu = aurrekoa(state.hauteskundea) || state.hauteskundea;
  hautatzaileakMargotu(); await arnasa();
  await prestatu(); hautatu(null); zikindu(); ezarriMaila(); hautatzaileakMargotu(); margotu();
}
async function prestatu() {
  const uf = state.modua === "udalforal" ? ufPareja() || [] : [];
  const oy = state.modua === "compare" ? state.konparatu : aurrekoa(state.hauteskundea);
  await Promise.all(uf.map(kargatu));
  await Promise.all([state.hauteskundea, ...osagK(state.hauteskundea), ...(oy && state.modua === "compare" ? [oy, ...osagK(oy)] : [])].map(kargatu));
  // las anteriores (flechas ▲▼) no bloquean: el panel se repinta en cuanto llegan
  // en la capa «Parte-hartzea», el puntero enseña las tres últimas elecciones de cada zona: hacen falta las
  // convocatorias que forman lo que se ve («Azkenak» es un fichero aparte) y una generación más de anteriores
  const hirugarrenak = state.modua === "turnout" ? [...osagaiak(), ...aurrekoak().map(aurrekoa).filter(Boolean)] : [];
  const aurrek = [...(oy && state.modua !== "compare" ? [oy, ...osagK(oy)] : []), ...aurrekoak(), ...hirugarrenak].filter(x => !datuak(x));
  if (aurrek.length) Promise.all(aurrek.map(kargatu)).then(() => { zikindu(); ezarriMaila(); margotu(); });
  if (typeof map !== "undefined") await (mailaAktiboa() === "sec" ? sekzioakKargatu() : mailaKargatu(mailaAktiboa()));
}
// (la categoría se elige en el menú radial de abajo; arriba solo queda la convocatoria concreta)

// ---- línea de tiempo: arriba las elecciones (una fila), abajo un puntero que se arrastra a cualquier
// fecha; en cada zona se ve su última elección de ese tipo hasta la fecha del puntero ----
const HILAK = ["urt.", "ots.", "mar.", "api.", "mai.", "eka.", "uzt.", "abu.", "ira.", "urr.", "aza.", "abe."];
const dataTestu = (t) => { const u = Math.floor(t), h = Math.min(11, Math.round((t - u) * 12));  // «2017ko uzt.» / «jul. 2017»
  return HIZK === "eu" ? `${u}ko ${HILAK[h]}` : new Date(u, h, 1).toLocaleDateString(LOKALEA, { month: "short", year: "numeric" }); };
let denboraPlay = null;
function lerroTartea() { const ks = denborakoak(); return ks.length ? [Math.floor(dataZ(ks[0])), Math.floor(dataZ(ks.at(-1))) + 1] : [0, 1]; }
const osaeraTestua = (ks) => [...ks].sort((a, b) => dataZ(b) - dataZ(a)).map(k => `${ZONA_LABUR[eremua(k)] || ""} ${izena(k)}`).join(" · ");
function lerroaMargotu() {
  const box = $("#denboralerroa"), ks = denborakoak(); box.hidden = !ks.length; if (box.hidden) return;
  const [t0, t1] = lerroTartea(), x = (t) => `${((t - t0) / (t1 - t0) * 100).toFixed(2)}%`;
  const tt = state.denboraT ?? dataZ(ks.at(-1));
  const orain = new Set(zona(state.hauteskundea) === "Azkenak" ? (INFO[state.hauteskundea].osagaiak || []) : [state.hauteskundea, ...osagK()]);
  // un año cada «pausoa», el menor que deje al menos 34 px entre etiquetas («2012» ocupa unos 26): sin juntarse en pantallas estrechas
  const pxUrteko = (box.querySelector(".dl-pista").clientWidth || 600) / (t1 - t0), pausoa = [1, 2, 4, 5, 10].find((p) => p * pxUrteko >= 34) || 10;
  let urteak = ""; for (let y = t0; y <= t1; y++) urteak += `<span class="dl-urtea" style="left:${x(y)}">${y % pausoa || y === t1 ? "" : y}</span>`;
  // una sola fila (círculo Hegoalde, rombo Iparralde); las de la misma fecha, un poco separadas
  const lagunak = {}; ks.forEach(k => { const g = dataZ(k).toFixed(2); (lagunak[g] = lagunak[g] || []).push(k); });
  const tartea = (k) => { const l = lagunak[dataZ(k).toFixed(2)], i = l.indexOf(k); return (i - (l.length - 1) / 2) * 9; };
  box.querySelector(".dl-pista").innerHTML = `<span class="dl-ardatza"></span>${urteak}` +
    ks.map(k => `<button class="dl-puntua ${zona(k) === "Iparralde" ? "ipa" : "heg"}${orain.has(k) ? " act" : ""}" style="left:calc(${x(dataZ(k))} + ${tartea(k)}px)" data-k="${k}"
      title="${esc(izena(k))} · ${esc(eremua(k))}" aria-label="${esc(izena(k))}, ${esc(eremua(k))}"></button>`).join("") +
    `<span class="dl-kurtsorea" style="left:${x(tt)}"></span><span class="dl-heldulekua" role="slider" tabindex="0" style="left:${x(tt)}"
      aria-label="${T.dataAukeratu}" aria-valuemin="${t0}" aria-valuemax="${t1}" aria-valuenow="${tt.toFixed(2)}" aria-valuetext="${state.denboraT == null ? T.gaur : dataTestu(tt)}"></span>`;
  box.querySelector(".dl-data").textContent = state.denboraT == null ? T.gaur : dataTestu(tt);
  box.querySelector(".dl-osaera").textContent = osaeraTestua(orain);
  $("#dlplay").textContent = denboraPlay ? "❚❚" : "▶"; $("#dlplay").setAttribute("aria-label", denboraPlay ? T.gelditu : T.erreproduzitu);
}
let lerroaZain = false;  // al cambiar el tamaño de la ventana, las etiquetas de los años se recalculan (una vez por fotograma)
addEventListener("resize", () => { if (!lerroaZain) { lerroaZain = true; requestAnimationFrame(() => { lerroaZain = false; lerroaMargotu(); }); } });
// Puntero en la fecha T (cualquier mes): en cada zona, su última elección hasta T; después de la última, «Gaur»
async function denboraEzarri(tt) {
  const ks = denborakoak(); if (!ks.length) return;
  tt = Math.max(dataZ(ks[0]), tt);  // antes de la primera elección no hay nada que ver
  if (tt >= dataZ(ks.at(-1)) - 1e-6) { await aldatuHauteskundea(azkena()); return; }
  const zatiak = denboraZatiak(tt);
  state.bakarrik = false;  // el puntero en una fecha: en cada zona, su última elección hasta ahí (todas juntas)
  state.denboraT = tt; state.hauteskundea = zatiak[0];
  if (state.modua === "compare" && state.konparatu === state.hauteskundea) state.konparatu = aurrekoa(state.hauteskundea) || state.hauteskundea;
  hautatzaileakMargotu(); await arnasa();
  await prestatu(); hautatu(null); zikindu(); ezarriMaila(); hautatzaileakMargotu(); margotu();
}
// Arrastrar: mientras se mueve, se ve la fecha y qué elecciones entran; al soltar, cambia el mapa
const pista = $("#denboralerroa .dl-pista");
let arrastaka = false;
function puntuanDago(e) { const r = pista.getBoundingClientRect(), [t0, t1] = lerroTartea();
  const t = t0 + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (t1 - t0); return Math.round(t * 12) / 12; }
function aurreikusi(tt) {
  const [t0, t1] = lerroTartea(), ks = denborakoak(), az = tt >= dataZ(ks.at(-1)) - 1e-6, x = `${((tt - t0) / (t1 - t0) * 100).toFixed(2)}%`;
  pista.querySelector(".dl-kurtsorea").style.left = x; pista.querySelector(".dl-heldulekua").style.left = x;
  const z = az ? INFO[azkena()].osagaiak || [] : denboraZatiak(Math.max(dataZ(ks[0]), tt));
  $("#denboralerroa .dl-data").textContent = az ? T.gaur : dataTestu(tt);
  $("#denboralerroa .dl-osaera").textContent = osaeraTestua(z);
  pista.querySelectorAll(".dl-puntua").forEach(b => b.classList.toggle("act", z.includes(b.dataset.k)));
}
pista.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".dl-puntua")) return;  // las elecciones se eligen con un clic
  arrastaka = true; playGelditu(); pista.setPointerCapture(e.pointerId); aurreikusi(puntuanDago(e)); e.preventDefault();
});
pista.addEventListener("pointermove", (e) => { if (arrastaka) aurreikusi(puntuanDago(e)); });
pista.addEventListener("pointerup", (e) => { if (!arrastaka) return; arrastaka = false; denboraEzarri(puntuanDago(e)); });
pista.addEventListener("pointercancel", () => { arrastaka = false; lerroaMargotu(); });
pista.addEventListener("keydown", (e) => {  // teclado: ← → un año; con Mayús, un mes
  if (!e.target.classList.contains("dl-heldulekua") || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  e.preventDefault(); playGelditu();
  const ks = denborakoak(), tt = state.denboraT ?? dataZ(ks.at(-1)), pausoa = (e.shiftKey ? 1 / 12 : 1) * (e.key === "ArrowLeft" ? -1 : 1);
  denboraEzarri(e.key === "Home" ? dataZ(ks[0]) : e.key === "End" ? Infinity : tt + pausoa).then(() => $("#denboralerroa .dl-heldulekua").focus());
});
// ▶: el puntero avanza por el tiempo, un mes cada PLAY_HILABETEA_MS; el mapa cambia solo cuando el puntero
// pasa por una elección nueva (cambia lo que se ve en alguna zona). Al llegar a hoy, «Gaur» y se para.
let playT = null, playKargatzen = false;
function playGelditu() {  // el puntero se queda donde se ha parado (lo que se ve no cambia hasta la siguiente elección)
  clearTimeout(denboraPlay); denboraPlay = null;
  if (playT != null && state.denboraT != null) { state.denboraT = playT; urlaIdatzi(); }
  playT = null; lerroaMargotu();
}
async function playUrratsa() {
  if (!denboraPlay) return;
  const ks = denborakoak(), azken = dataZ(ks.at(-1));
  playT = Math.round((playT + 1 / 12) * 12) / 12;
  if (playT >= azken - 1e-6) { await denboraEzarri(Infinity); playGelditu(); return; }
  aurreikusi(playT);
  const orain = [state.hauteskundea, ...osagK()].sort().join("+"), berria = denboraZatiak(playT).sort().join("+");
  if (berria !== orain && !playKargatzen) {  // nueva elección en el puntero: se cambia el mapa
    playKargatzen = true; await denboraEzarri(playT); playKargatzen = false;
    if (!denboraPlay) return;
    aurreikusi(playT);
  }
  denboraPlay = setTimeout(playUrratsa, PLAY_HILABETEA_MS);
}
async function play() {
  if (denboraPlay) { playGelditu(); return; }
  const ks = denborakoak(); if (!ks.length) return;
  denboraPlay = -1;
  playT = state.denboraT == null ? dataZ(ks[0]) : state.denboraT;  // desde «Gaur», desde el principio
  if (state.denboraT == null) await denboraEzarri(playT);
  lerroaMargotu(); aurreikusi(playT);
  denboraPlay = setTimeout(playUrratsa, PLAY_HILABETEA_MS);
}
$("#dlplay").addEventListener("click", play);
pista.addEventListener("click", (e) => { const b = e.target.closest(".dl-puntua"); if (b) { playGelditu(); aldatuHauteskundea(b.dataset.k); } });
$("#denboralerroa .dl-gaur").addEventListener("click", () => { playGelditu(); aldatuHauteskundea(azkena()); });
// Móvil: los controles se abren y cierran con ☰
// Ordenador: ☰ (o la tecla L) pliega y despliega el menú de la izquierda; el navegador lo recuerda
const mugikorra = () => innerWidth <= 700;
function menuaIkusi(ikusi) {
  $("#app").classList.toggle("menurik-ez", !ikusi); geziaEguneratu(ikusi);
  try { localStorage.setItem("behatokia-menua", ikusi ? "bai" : "ez"); } catch { /* sin almacenamiento */ }
  if (typeof izenakBerritu === "function") setTimeout(izenakBerritu, 240);  // las etiquetas ocupan el hueco libre
}
// Flecha en el borde del panel de herramientas: ‹ lo esconde, › lo vuelve a sacar
function geziaEguneratu(ikusi) {
  const b = $("#railbtn"); b.setAttribute("aria-expanded", ikusi); b.querySelector("span").textContent = ikusi ? "‹" : "›";
  b.setAttribute("aria-label", ikusi ? T.tresnakEzkutatu : T.tresnakErakutsi);
}
$("#railbtn").addEventListener("click", () => {
  if (mugikorra()) { const o = $("#rail").classList.toggle("open"); geziaEguneratu(o); }
  else menuaIkusi($("#app").classList.contains("menurik-ez"));
});
try { if (localStorage.getItem("behatokia-menua") === "ez") $("#app").classList.add("menurik-ez"); } catch { /* sin almacenamiento */ }
geziaEguneratu(mugikorra() ? false : !$("#app").classList.contains("menurik-ez"));
// Menú ☰ (Mapa, Parlamentua, Iturriak, Guri buruz): se cierra al elegir o al pulsar fuera
document.addEventListener("click", (e) => { const d = $(".nabigazioa"); if (d && d.open && (!d.contains(e.target) || e.target.closest("a"))) d.open = false; });
$("#rail").addEventListener("click", (e) => { if (e.target.closest(".mode") && innerWidth <= 700) { $("#rail").classList.remove("open"); geziaEguneratu(false); } });
// ---- menú radial (abajo): anillo interior = categorías; manteniendo el ratón, el exterior = convocatorias ----
const KATS = Object.keys(INDEX.kategoriak).filter(t => INDEX.kategoriak[t].length);
const pt = (r, a) => [CX + r * Math.cos(a * Math.PI / 180), CY - r * Math.sin(a * Math.PI / 180)];
function sector(r0, r1, aL, aR) {  // corona circular de aL (izquierda) a aR (derecha), en grados, 0 = derecha
  const [x1, y1] = pt(r1, aL), [x2, y2] = pt(r1, aR), [x3, y3] = pt(r0, aR), [x4, y4] = pt(r0, aL);
  return `M${x1},${y1} A${r1},${r1} 0 0 1 ${x2},${y2} L${x3},${y3} A${r0},${r0} 0 0 0 ${x4},${y4} Z`;
}
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const dialBox = $("#dial");
const svg = el("svg", { viewBox: "0 0 500 256", role: "menu", "aria-label": T.hauteskundeMotak }, dialBox);
el("path", { class: "hit", d: sector(0, R_I1 + 8, 180, 0), fill: "transparent" }, svg);  // zona "caliente": no cerrar al moverse entre anillos
const ring = el("g", { class: "ring" }, svg);
const gKats = el("g", {}, svg);
const hub = el("g", { class: "hub" }, svg);
el("path", { d: `M${CX - R_HUB},${CY} A${R_HUB},${R_HUB} 0 0 1 ${CX + R_HUB},${CY} Z` }, hub);
const t1 = el("text", { class: "t1", x: CX, y: CY - 22 }, hub), t2 = el("text", { class: "t2", x: CX, y: CY - 8 }, hub);
const hubTexto = (a, b) => { t1.textContent = a; t2.textContent = b;  // que quepa en el semicírculo central
  t1.setAttribute("font-size", a.length > 20 ? "9.5px" : a.length > 11 ? "11px" : "14px"); };
const hubActivo = () => hubTexto(T.kat[state.mapa] || "", zona(state.hauteskundea) === "Azkenak" ? T.zonak.Azkenak : urtea(state.hauteskundea));

// Anillo interior: una cuña por categoría, de izquierda a derecha
const paso = 180 / KATS.length;
KATS.forEach((t, i) => {
  const aL = 180 - i * paso, aR = aL - paso, am = (aL + aR) / 2, [x, y] = pt((R_K0 + R_K1) / 2 + 4, am);
  const g = el("g", { class: "kat", "data-kat": t, tabindex: 0, role: "menuitem", "aria-label": T.kat[t] || t }, gKats);
  el("path", { d: sector(R_K0, R_K1, aL - .6, aR + .6) }, g);
  const tk = el("text", { x, y: y - 5 }, g); tk.textContent = T.kat[t] || t;
  const ancho = 0.82 * ((R_K0 + R_K1) / 2 + 4) * paso * Math.PI / 180;  // cuerda aprox. del gajo a esa altura
  if (tk.textContent.length * 7 > ancho) {  // nombres largos: letra más pequeña y, si aun así no cabe, algo comprimida
    tk.setAttribute("font-size", "10px");
    if (tk.textContent.length * 6.1 > ancho) { tk.setAttribute("textLength", ancho.toFixed(0)); tk.setAttribute("lengthAdjust", "spacingAndGlyphs"); }
  }
  el("text", { class: "n", x, y: y + 9 }, g).textContent = INDEX.kategoriak[t].length;
});

// Orden del anillo exterior: Hegoalde (antigua → reciente) · Euskal Herria · Azkenak · Iparralde (reciente → antigua)
function ordenAnillo(t) {
  const ks = INDEX.kategoriak[t], de = (z) => ks.filter(k => zona(k) === z);
  return [...de("Hegoalde"), ...de("Euskal Herria"), ...de("Azkenak"), ...de("Iparralde").reverse()];
}
const etiquetaCorta = (k) => zona(k) === "Azkenak" ? T.zonak.Azkenak.toUpperCase()
  : `${INFO[k].letra || LETRA[mota(k)] ? (INFO[k].letra || LETRA[mota(k)]) + " " : ""}${mota(k) === "municipales" ? urtea(k) : urtea(k).replace("-", "·")}`;
let anilloDe = null;
function abrirAnillo(t) {
  anilloDe = t; ring.innerHTML = "";
  gKats.querySelectorAll(".kat").forEach(g => g.classList.toggle("on", g.dataset.kat === t));
  const ks = ordenAnillo(t), p = 180 / ks.length;
  ks.forEach((k, i) => {
    const aL = 180 - i * p, aR = aL - p, am = (aL + aR) / 2, [x, y] = pt((R_I0 + R_I1) / 2 + 6, am);
    const g = el("g", { class: "it" + (k === state.hauteskundea ? " act" : ""), "data-k": k, tabindex: 0, role: "menuitem", "aria-label": `${izena(k)} (${zona(k)})` }, ring);
    el("path", { class: "seg", d: sector(R_I0, R_I1, aL - .4, aR + .4) }, g);
    el("path", { class: "zb", d: sector(R_I0 + 1, R_I0 + 5, aL - .4, aR + .4), fill: ZONA_COLOR[zona(k)] }, g);
    let rot = -am; if (am > 90) rot += 180;  // texto radial (del centro hacia fuera), siempre legible
    const tx = el("text", { x, y, transform: `rotate(${rot} ${x} ${y})` }, g);
    tx.textContent = etiquetaCorta(k);
    if (ks.length > 12) tx.setAttribute("font-size", "9.5px");
  });
  // Rótulos de zona en los extremos del anillo
  const zs = [...new Set(ks.map(zona))];
  // en vertical, pegados a los extremos izquierdo (Hegoalde) y derecho (Iparralde) del anillo
  if (zs.includes("Hegoalde")) { const x = CX - R_I1 - 6, y = CY - 4; el("text", { class: "zl", x, y, "text-anchor": "start", transform: `rotate(-90 ${x} ${y})` }, ring).textContent = T.zonak.Hegoalde; }
  if (zs.includes("Iparralde")) { const x = CX + R_I1 + 13, y = CY - 4; el("text", { class: "zl", x, y, "text-anchor": "start", transform: `rotate(-90 ${x} ${y})` }, ring).textContent = T.zonak.Iparralde; }
  ring.classList.add("on"); svg.classList.add("abierto"); arnasa().then(izenakBerritu);  // etiquetas del mapa, después de pintar el anillo (INP)
}
function cerrarAnillo() { anilloDe = null; ring.classList.remove("on"); svg.classList.remove("abierto"); arnasa().then(izenakBerritu); gKats.querySelectorAll(".kat").forEach(g => g.classList.remove("on")); hubActivo(); }
function pintarDial() {
  gKats.querySelectorAll(".kat").forEach(g => g.classList.toggle("act", g.dataset.kat === state.mapa));
  if (anilloDe) abrirAnillo(anilloDe);
  hubActivo();
}

let tAbrir = null, tCerrar = null;
const alSalir = () => { clearTimeout(tAbrir); clearTimeout(tCerrar); tCerrar = setTimeout(cerrarAnillo, 350); };
svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") alSalir(); });
svg.addEventListener("pointerenter", () => clearTimeout(tCerrar));
gKats.querySelectorAll(".kat").forEach(g => {
  const t = g.dataset.kat;
  g.addEventListener("pointerenter", (e) => {
    hubTexto(T.kat[t] || t, `${INDEX.kategoriak[t].length} ${T.hauteskundeN}`);
    if (e.pointerType !== "mouse") return;
    clearTimeout(tAbrir); tAbrir = setTimeout(() => abrirAnillo(t), anilloDe ? 120 : 260);  // mantener el ratón
  });
  g.addEventListener("pointerleave", () => clearTimeout(tAbrir));
  g.addEventListener("click", (e) => {
    if (e.pointerType && e.pointerType !== "mouse" && anilloDe !== t) { abrirAnillo(t); return; }  // táctil: primer toque despliega
    aldatuMapa(t);
  });
  g.addEventListener("focus", () => abrirAnillo(t));
  g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aldatuMapa(t); } });
});
ring.addEventListener("pointerover", (e) => { const g = e.target.closest(".it"); if (g) hubTexto(izena(g.dataset.k).replace(/^[^:]*: /, ""), zona(g.dataset.k)); });
ring.addEventListener("click", (e) => { const g = e.target.closest(".it"); if (g) aldatuHauteskundea(g.dataset.k); });
ring.addEventListener("keydown", (e) => { const g = e.target.closest(".it"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); aldatuHauteskundea(g.dataset.k); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarAnillo(); });
document.addEventListener("pointerdown", (e) => { if (anilloDe && !dialBox.contains(e.target)) cerrarAnillo(); });
pintarDial();
$("#ufsel").addEventListener("change", () => { state.ufAlderdia = $("#ufsel").value; zikindu(); ezarriMaila(); margotu(); });
document.querySelectorAll(".mode[data-mode]").forEach(b => b.addEventListener("click", async () => {
  state.modua = b.dataset.mode; document.querySelectorAll(".mode[data-mode]").forEach(x => x.setAttribute("aria-pressed", x === b));
  if (state.modua === "compare" && state.konparatu === state.hauteskundea) state.konparatu = aurrekoa(state.hauteskundea) || state.hauteskundea;
  await prestatu(); zikindu(); ezarriMaila(); hautatzaileakMargotu(); margotu();
}));
const levelSel = $("#level");
for (const k in LEVELS) { const o = document.createElement("option"); o.value = k; o.textContent = T.mailak[k] || LEVELS[k]; levelSel.appendChild(o); }
levelSel.addEventListener("change", async () => { state.maila = levelSel.value; if (state.maila === "sec") await sekzioakKargatu(); else await mailaKargatu(state.maila); hautatu(null); ezarriMaila(); margotu(); });
map.on("zoomend", async () => {
  if (state.maila !== "auto") return;
  if (mailaAktiboa() === "sec") await sekzioakKargatu();  // primera vez en el nivel de secciones, o año distinto
  else await mailaKargatu(mailaAktiboa());
  garbitu(mailaAktiboa()); margotu();
});
// Crédito de las ortofotos a pie de mapa (lo piden sus licencias): solo cuando se ven
function ortoKreditua() { $("#ortokreditua").hidden = !(state.satelitea && map.getZoom() >= IRUDIAK.ortoMinZoom); }
map.on("zoom", ortoKreditua);
ortoKreditua();
function sateliteaEzarri() {
  for (const l of ["sat", "orto"]) map.setLayoutProperty(l, "visibility", state.satelitea ? "visible" : "none");
  ortoKreditua();
  for (const k in GEO) map.setPaintProperty(k + "-fill", "fill-opacity", ["case", ["boolean", ["feature-state", "hover"], false], .9, state.satelitea ? .62 : .9]);
}
$("#basemap").addEventListener("click", () => { state.satelitea = !state.satelitea; $("#basemap").setAttribute("aria-pressed", state.satelitea);
  if (estiloaPrest) sateliteaEzarri(); else map.once("style.load", sateliteaEzarri);  // ver ezarriMaila (03-mapa.js)
  paletaEzarri();  // al apagar el satélite en tema claro, el mapa pasa a la paleta de papel
});

// ---- itxura argia / iluna ----
// La interfaz la cambia el CSS solo (tokens de src/tema.css, y web/tema.js aplica la guardada
// antes del primer pintado). Aquí va lo que el CSS no alcanza: los colores del mapa, que son
// propiedades de MapLibre. La paleta del mapa depende del tema Y del satélite: sobre imagen
// de satélite manda la oscura aunque la interfaz esté en claro, porque las imágenes son de
// tono medio y las líneas claras se perderían.
const temaSistema = matchMedia("(prefers-color-scheme: light)");
function temaAktiboa() {
  const g = document.documentElement.getAttribute("data-theme");
  return g === "light" || g === "dark" ? g : (temaSistema.matches ? "light" : "dark");
}
function paletaEzarri(lehena) {
  const berria = (temaAktiboa() === "light" && !state.satelitea) ? PALETAK.argi : PALETAK.ilun;
  if (berria === MAPA_K && !lehena) return;
  MAPA_K = berria;
  document.documentElement.setAttribute("data-mapa", MAPA_K === PALETAK.argi ? "argi" : "ilun");
  MARGIN_BINS = MAPA_K.margin; TURNOUT_BINS = MAPA_K.turnout; UF_BINS = MAPA_K.uf;
  NODATA = MAPA_K.nodata; UNCONTESTED = MAPA_K.uncontested;
  CHANGE = MAPA_K.change; ZONA_COLOR = MAPA_K.zona;
  // en el arranque no se repinta: todavía no hay datos y lo hace 10-abiarazi.js
  const f = lehena ? mapaKoloreakSoilik : mapaKoloreak;
  if (!estiloaPrest) { map.once("style.load", f); return; }
  f();
}
// Las capas llevan el color en una expresión fijada al crear el estilo (03-mapa.js): hay que
// reescribirla. Los rellenos van en properties.c, así que basta invalidar y volver a pintar.
function mapaKoloreak() { mapaKoloreakSoilik(); zikindu(); ezarriMaila(); hautatzaileakMargotu(); margotu(); }
function mapaKoloreakSoilik() {
  map.setPaintProperty("fondo", "background-color", MAPA_K.fondoa);
  map.setPaintProperty("muga-udal", "line-color", MAPA_K.muga);
  map.setPaintProperty("muga-esk", "line-color", MAPA_K.mugaEsk);
  map.setPaintProperty("muga-lur", "line-color", MAPA_K.mugaLur);
  for (const k in GEO) {
    map.setPaintProperty(k + "-line", "line-color",
      ["case", ["boolean", ["feature-state", "sel"], false], MAPA_K.nabarmen,
               ["boolean", ["feature-state", "hover"], false], MAPA_K.nabarmen, MAPA_K.muga]);
  }
  if (map.hasImage("marra")) map.removeImage("marra");  // se vuelve a crear con el color nuevo
}
function temaIdatzi(t) {
  try { localStorage.setItem("tema", t); } catch (e) { /* modo privado: solo esta sesión */ }
  document.documentElement.setAttribute("data-theme", t);
  temaBotoia(); paletaEzarri(true);
}
function temaBotoia() {
  // el icono (sol / luna) lo elige el CSS con aria-pressed; aquí solo el estado y lo que oye
  // un lector de pantalla, que tiene que decir a qué tema se va, no en cuál estamos
  const b = $("#tema"), argia = temaAktiboa() === "light";
  b.setAttribute("aria-pressed", String(argia));
  b.setAttribute("aria-label", argia ? T.ilunaAria : T.argiaAria);
}
$("#tema").addEventListener("click", () => temaIdatzi(temaAktiboa() === "light" ? "dark" : "light"));
// Si no hay elección guardada, seguir al sistema cuando el Mac cambie de día a noche
temaSistema.addEventListener("change", () => {
  const g = document.documentElement.getAttribute("data-theme");
  if (g !== "light" && g !== "dark") { temaBotoia(); paletaEzarri(); }
});
temaBotoia(); paletaEzarri(true);
const dl = $("#munis");
// El buscador sugiere el nombre en euskera y reconoce también el oficial (Pamplona, Bayonne…)
function bilatzaileaBete() { GEO.muni.features.slice().sort((a, b) => a.properties.name.localeCompare(b.properties.name)).forEach(f => {
  const o = document.createElement("option"); o.value = f.properties.name;
  if (f.properties.ofiziala && f.properties.ofiziala !== f.properties.name) o.label = f.properties.ofiziala;
  dl.appendChild(o); }); }
$("#q").addEventListener("change", () => {
  const v = $("#q").value.trim().toLowerCase(); if (!v) return;
  const izenak = (f) => [f.properties.name, f.properties.ofiziala || ""].map(x => x.toLowerCase());
  const f = GEO.muni.features.find(f => izenak(f).includes(v)) || GEO.muni.features.find(f => izenak(f).some(x => x.includes(v)));
  if (f && !(ENKLABEAK.includes(String(f.id)) && !enklabeakDaude())) joan("muni", f.id);  // enclaves: solo en las municipales y las europeas
});
// ---- Sala de situación: aviso de nivel y atajos de teclado ----
// Aviso breve arriba a la izquierda del mapa ("MAILA · ESKUALDEAK", "UDALAK · AZKENAK")
let tToast = null;
function abisua(testua) {
  const t = $("#toast"); t.textContent = testua; t.hidden = false;
  clearTimeout(tToast); tToast = setTimeout(() => { t.hidden = true; }, TOAST_MS);
}
let azkenMaila = null;
map.on("zoomend", () => {
  const m = mailaAktiboa();
  if (azkenMaila && m !== azkenMaila) abisua(`${T.maila} · ${T.mailak[m] || LEVELS[m] || m}`);
  azkenMaila = m;
});
map.on("load", () => { azkenMaila = mailaAktiboa(); });

// Euskal Herria osoa: lo mismo que el primer paso de la ruta de arriba
const osoa = () => $("#crumb button").click();

// Ayuda con todas las teclas
function laguntza(ireki) {
  const l = $("#laguntza"); l.hidden = !ireki; $("#laguntzabtn").setAttribute("aria-expanded", ireki);
  if (ireki) $("#laguntzaItxi").focus();
}
$("#laguntzabtn").addEventListener("click", () => laguntza($("#laguntza").hidden));
$("#laguntzaItxi").addEventListener("click", () => laguntza(false));

// Atajos: no actúan mientras se escribe en el buscador o se usa un desplegable
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, select, textarea")) return;
  const k = e.key.toLowerCase();
  if (e.key === "Escape") { if (!$("#laguntza").hidden) laguntza(false); else if (state.hautatua) hautatu(null); return; }
  if (e.key === "?") { laguntza($("#laguntza").hidden); return; }
  if (e.key === "/") { e.preventDefault(); if (innerWidth <= 700) $("#rail").classList.add("open"); else menuaIkusi(true); $("#q").focus(); return; }
  if (k === "l") { $("#railbtn").click(); return; }
  if (e.key === "0") { osoa(); return; }
  if (/^[1-9]$/.test(e.key) && KATS[+e.key - 1]) {
    const t = KATS[+e.key - 1]; aldatuMapa(t); abisua(`${T.kat[t] || t} · ${T.zonak.Azkenak}`); return;
  }
  if (k === "q" || k === "e") {  // misma categoría, convocatoria anterior / siguiente por fecha; Azkenak al final
    const ks = hauteskundeak().filter(x => zona(x) !== "Azkenak").sort((a, b) => urtea(a).localeCompare(urtea(b)))
      .concat(hauteskundeak().filter(x => zona(x) === "Azkenak"));
    const i = ks.indexOf(state.hauteskundea), j = i + (k === "e" ? 1 : -1);
    if (j >= 0 && j < ks.length) { aldatuHauteskundea(ks[j]); abisua(zona(ks[j]) === "Azkenak" ? T.zonak.Azkenak : izena(ks[j])); }
    return;
  }
  if (TEKLA_MODUAK[k]) { document.querySelector(`.mode[data-mode="${TEKLA_MODUAK[k]}"]`).click(); return; }
  if (k === "s") { $("#basemap").click(); return; }
  if (k === "i") { $("#tema").click(); return; }
  if (k === "p") { play(); return; }
  if (k === "k") fitxaAldatu(state.fitxa === "eserlekuak" ? "emaitzak" : "eserlekuak");
});

// ---- Móvil: la hoja de resultados se despliega tocando el asa o arrastrando el asa / las pestañas ----
const hud = $("#hud"), heldulekua = $("#heldulekua");
function orriaZabaldu(bai) { hud.classList.toggle("zabalik", bai); heldulekua.setAttribute("aria-expanded", bai); if (!bai) $("#body").scrollTop = 0; }
heldulekua.addEventListener("click", () => orriaZabaldu(!hud.classList.contains("zabalik")));
let arrastatu = null;  // [y inicial, ¿abierta al empezar?]
for (const el of [heldulekua, $("#hudfitxak")]) {
  el.addEventListener("pointerdown", (e) => { if (MUGIKORRA.matches) arrastatu = [e.clientY, hud.classList.contains("zabalik")]; });
}
addEventListener("pointerup", (e) => {
  if (!arrastatu) return; const dy = e.clientY - arrastatu[0];
  if (dy < -30 && !arrastatu[1]) orriaZabaldu(true); else if (dy > 30 && arrastatu[1]) orriaZabaldu(false);
  arrastatu = null;
});
// al elegir una pestaña en el móvil, la hoja se abre para verla
document.querySelectorAll("#hudfitxak [role=tab]").forEach(b => b.addEventListener("click", () => { if (MUGIKORRA.matches) orriaZabaldu(true); }));
// ---- Eserlekuak: el reparto de escaños de cada institución (pestaña del panel de la derecha) ----
// Parlamentos, Juntas Generales y Congreso salen de data/eserlekuak.json (scripts/eserlekuak.py); los concejales,
// de los datos de cada municipio. Hegoalde va por partidos; los totales de Euskal Herria, por bloques.
const blokea = (f) => BLQ[f] || "LOCAL";
const ordena = (a, b) => (HEMIZIKLO_ORDENA.indexOf(blokea(a[0])) - HEMIZIKLO_ORDENA.indexOf(blokea(b[0]))) || (b[1] - a[1]);

// Hemiciclo: N escaños en filas concéntricas, ocupados de izquierda a derecha según HEMIZIKLO_ORDENA.
// Los puntos tienen siempre el mismo tamaño (el de un parlamento grande) y el semicírculo se encoge lo justo para
// que quepan juntos: un ayuntamiento de 7 concejales sale compacto, no 7 puntos sueltos en un arco enorme.
function hemizikloa(c) {  // c: [[gakoa, eserlekuak, kolorea, izena]]
  const N = c.reduce((s, x) => s + x[1], 0); if (!N) return "";
  const RMAX = 96, RP = 5.5, TARTEA = RP * 2.5, BARNE = 27 + RP;  // radio máximo, radio del punto, paso, fila interior (hueco de la cifra)
  // Filas desde BARNE hacia fuera, cada una con los puntos que le caben a paso TARTEA; solo las necesarias
  const lekua = (r) => Math.floor(Math.PI * r / TARTEA) + 1;
  let ilarak = 1; while (Array.from({ length: ilarak }, (_, i) => lekua(BARNE + i * TARTEA)).reduce((a, b) => a + b, 0) < N) ilarak++;
  let R = BARNE + (ilarak - 1) * TARTEA, radioak, mugak;
  if (N <= lekua(BARNE + TARTEA)) { R = Math.max(BARNE, (N - 1) * TARTEA / Math.PI); radioak = [1]; mugak = [N]; ilarak = 1; }  // hasta ~11: una sola fila
  else if (R <= RMAX) { radioak = Array.from({ length: ilarak }, (_, i) => (BARNE + i * TARTEA) / R); mugak = radioak.map(r => lekua(r * R)); }
  else {  // parlamento grande: radio máximo y puntos más pequeños
    R = RMAX; ilarak = Math.ceil(Math.sqrt(N / 4.5));
    radioak = Array.from({ length: ilarak }, (_, i) => .42 + .58 * i / (ilarak - 1)); mugak = radioak.map(() => Infinity);
  }
  const batura = radioak.reduce((a, b) => a + b, 0);
  const zenbat = radioak.map((r, i) => Math.min(mugak[i], Math.max(1, Math.round(N * r / batura))));
  for (let i = ilarak - 1, falta = N - zenbat.reduce((a, b) => a + b, 0); falta; ) {  // cuadrar el total, de fuera adentro
    if (falta > 0 && zenbat[i] < mugak[i]) { zenbat[i]++; falta--; } else if (falta < 0 && zenbat[i] > 1) { zenbat[i]--; falta++; } else i = (i - 1 + ilarak) % ilarak;
  }
  const puntuak = [];
  radioak.forEach((r, i) => { const n = zenbat[i]; for (let j = 0; j < n; j++) { const a = Math.PI * (n === 1 ? .5 : 1 - j / (n - 1)); puntuak.push([a, R * r * Math.cos(a), -R * r * Math.sin(a)]); } });
  puntuak.sort((p, q) => q[0] - p[0]);
  // en los parlamentos más grandes (R = RMAX) los puntos se achican para no solaparse
  const rp = Math.min(RP, ...radioak.map((r, i) => zenbat[i] > 1 ? Math.PI * R * r / (zenbat[i] - 1) * .42 : RP),
    ilarak > 1 ? R * (radioak[1] - radioak[0]) * .42 : RP);
  const W = 2 * (R + rp + 2), H = R + 2 * rp + 4, cx = W / 2, cy = H - rp - 2;
  let i = 0, s = "";
  for (const [, n, kol, izen] of c) for (let k = 0; k < n; k++, i++) { const p = puntuak[i]; if (p) s += `<circle cx="${(cx + p[1]).toFixed(1)}" cy="${(cy + p[2]).toFixed(1)}" r="${rp.toFixed(2)}" fill="${kol}"><title>${izen}</title></circle>`; }
  // mismo tamaño de punto en pantalla en todos los hemiciclos: el ancho máximo sigue al del dibujo
  return `<svg class="hemi" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" style="max-width:${Math.round(340 * W / 207)}px" role="img" aria-label="${N} ${T.eserleku}">${s}<text x="${cx.toFixed(1)}" y="${(cy - 4).toFixed(1)}" class="hemi-n">${N}</text></svg>`;
}
// Variación de escaños (enteros): ▲ 2 / ▼ 1 / =
const dsfmt = (d) => d == null ? "" : `<span class="${d > 0 ? "up" : d < 0 ? "down" : ""}">${d > 0 ? "▲" : d < 0 ? "▼" : "="}${d ? " " + Math.abs(d) : ""}</span>`;
function zerrenda(c, N, aurrekoa) {  // filas: color, nombre, escaños y, si hay con qué comparar, su variación
  return `<div class="eser-zer">${c.map(([g, n, kol, izen]) => `<div class="row"><span class="nm"><i class="sq" style="background:${kol}"></i>${izen}</span><span class="val">${typeof n === "number" ? fmt(n) : n}${aurrekoa ? " " + dsfmt((typeof n === "number" ? n : 0) - (aurrekoa[g] || 0)) : ""}</span></div>`).join("")}` +
    (aurrekoa ? Object.entries(aurrekoa).filter(([g, n]) => n && !c.some(x => x[0] === g)).map(([g, n]) =>  // los que ya no tienen escaño
      `<div class="row galdu"><span class="nm"><i class="sq" style="background:${FAM[g] || FAM.LOCAL}"></i>${short(g)}</span><span class="val">0 ${dsfmt(-n)}</span></div>`).join("") : "") + "</div>" +
    (N ? `<p class="hint">${T.gehiengoa}: ${Math.floor(N / 2) + 1}</p>` : "");
}
const eserMapa = (c) => Object.fromEntries(c.map(x => [x[0], x[2]]));  // [[alderdia, alderdia, eserlekuak]] → {alderdia: eserlekuak}
const izenGako = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
// Lo que se analiza: bloque (CAV, Iparralde: «zona»), herrialde, circunscripción o municipio seleccionado en el mapa (o nada:
// todo el ámbito). Nafarroa, como bloque, es su herrialde
function hautaketa() {
  const id = state.hautatua; if (!id) return {};
  const s = String(id);
  if (s.includes("|")) { const [t, n] = s.split("|");
    if (mailaAktiboa() === "eremua") return n === "Nafarroa" ? { t: n, izena: lurIzena(n) } : { zona: n, izena: eremuIzena(n) };
    return { t, circ: mailaAktiboa() === "barruti_elektorala" ? n : null, izena: lurIzena(n) }; }
  const muni = s.startsWith("FR") ? s.split("-")[0] : s.slice(0, 5), m = MUNIS[muni] || {};
  return { t: m.t, muni, izena: m.n };
}
const BN_LURRALDEA = { Arabako: "Araba", Bizkaiko: "Bizkaia", Gipuzkoako: "Gipuzkoa" };
const erakIzena = (e) => esc(T.erakundeak[e.izena] || e.izena);  // nombre de la institución en el idioma elegido
function erakundeaHTML(e, k, h) {
  const aur = (ESERLEKUAK[aurrekoa(k)] || []).find(p => p.izena === e.izena);
  const lur = BN_LURRALDEA[e.izena.split(" ")[0]];  // Batzar Nagusiak: la institución entera es de un herrialde
  const barrutia = (b, izenburua, pb) => {
    const c = b.c.map(x => [x[0], x[2]]).sort(ordena).map(([f, n]) => [f, n, FAM[f] || FAM.LOCAL, short(f)]);
    return `<section class="erakundea"><div class="lbl">${izenburua}</div>${hemizikloa(c)}${zerrenda(c, 0, pb ? eserMapa(pb.c) : null)}</section>`;
  };
  if (h.zona) {  // la CAV o Iparralde: la institución entera si es solo suya (Legebiltzarra, Batzar Nagusiak); si no, sus herrialdes
    const nireak = (ee) => ee.barrutiak.filter(x => LUR_ZONA[x.izena] === h.zona);
    const osoa = lur ? LUR_ZONA[lur] === h.zona : e.barrutiak.length > 0 && nireak(e).length === e.barrutiak.length;
    if (!osoa) {
      if (!nireak(e).length) return "";
      const batu = (bb) => { const m = {}; for (const b of bb) for (const x of b.c) m[x[0]] = (m[x[0]] || 0) + x[2]; return { c: Object.entries(m).map(([f, n]) => [f, f, n]) }; };
      return barrutia(batu(nireak(e)), `${erakIzena(e)} · ${esc(eremuIzena(h.zona))} · ${urtea(k)}`, aur && nireak(aur).length ? batu(nireak(aur)) : null);
    }
  } else if (h.t) {  // un herrialde (o algo dentro de él): su parte de la institución
    const b = e.barrutiak.find(x => x.izena === h.t);
    if (b) return barrutia(b, `${erakIzena(e)} · ${esc(lurIzena(h.t))} · ${urtea(k)}`, aur && aur.barrutiak.find(x => x.izena === h.t));
    if (lur !== h.t) return "";
    if (h.circ) {
      const bc = e.barrutiak.find(x => izenGako(x.izena) === izenGako(h.circ) || izenGako(x.izena).includes(izenGako(h.circ)) || izenGako(h.circ).includes(izenGako(x.izena)));
      if (bc) return barrutia(bc, `${erakIzena(e)} · ${esc(lurIzena(bc.izena))} · ${urtea(k)}`, aur && aur.barrutiak.find(x => x.izena === bc.izena));
    }
  }
  const c = e.c.map(x => [x[0], x[2]]).sort(ordena).map(([f, n]) => [f, n, FAM[f] || FAM.LOCAL, short(f)]);
  const barrutiak = e.barrutiak.length > 1 ? `<details class="barrutiak"${e.barrutiak.length <= 4 ? " open" : ""}><summary>${T.barrutika}</summary>` +
    e.barrutiak.map(b => `<div class="barr"><span class="bn">${esc(lurIzena(b.izena))} <b>${b.n}</b></span><span class="bc">${b.c.map(x => `<i style="background:${FAM[x[0]] || FAM.LOCAL};flex:${x[2]}" title="${short(x[0])} ${x[2]}">${x[2]}</i>`).join("")}</span></div>`).join("") + "</details>" : "";
  return `<section class="erakundea"><div class="lbl">${erakIzena(e)} · ${urtea(k)}${e.iturria === "dhondt" ? ` <span class="badge" title="${T.dhondtAzalpena}">d'Hondt</span>` : ""}${aur ? ` <span class="aur">Δ ${urtea(aurrekoa(k))}</span>` : ""}</div>
    ${hemizikloa(c)}${zerrenda(c, e.guztira, aur ? eserMapa(aur.c) : null)}${barrutiak}</section>`;
}
// Concejales: suma por herrialde (Hegoalde por partidos, Iparralde por bloques) y de Euskal Herria (por bloques)
function zinegotziBatu(udalak) {
  const lur = {}, eh = {}; let hutsik = 0;
  for (const x of udalak) for (const [ine, r] of Object.entries(datuak(x).muni)) {
    const t = (MUNIS[ine] || {}).t || "?", ipa = ine.startsWith("FR");
    if (r.c.every(c => c[4] == null)) { hutsik++; continue; }
    for (const c of r.c) {
      if (!c[4]) continue;
      const g = ipa ? blokea(c[1]) : c[1];
      (lur[t] = lur[t] || {})[g] = (lur[t][g] || 0) + c[4];
      eh[blokea(c[1])] = (eh[blokea(c[1])] || 0) + c[4];
    }
  }
  return { lur, eh, hutsik };
}
function zinegotziak(udalak, h) {
  udalak = udalak.filter(x => mota(x) === "municipales" && datuak(x));
  if (!udalak.length) return "";
  if (h.muni) {  // su ayuntamiento
    const id = h.muni, x = udalak.find(u => datuak(u).muni[id]), r = x && datuak(x).muni[id];
    if (!r) return "";
    if (r.c.every(c => c[4] == null)) return `<p class="hint">${T.zinegotzirikEz}</p>`;
    const gakoa = (c) => !id.startsWith("FR") && c[1] !== "LOCAL" ? c[1] : c[0];  // Hegoalde: por partido (las siglas cambian)
    const c = r.c.filter(c => c[4]).map(c => [gakoa(c), c[4], FAM[c[1]] || FAM.LOCAL, esc(c[0])]);
    const pr = aurrekoErregistroa("muni", id), aur = pr && !pr.c.every(y => y[4] == null) ? {} : null;
    if (aur) for (const y of pr.c) if (y[4]) aur[gakoa(y)] = (aur[gakoa(y)] || 0) + y[4];
    return `<section class="erakundea"><div class="lbl">${NAME[id] || esc(r.n)} · ${T.udala} · ${urtea(x)}</div>${hemizikloa(c)}${zerrenda(c, r.esc || c.reduce((s, y) => s + y[1], 0), aur)}</section>`;
  }
  const { lur, eh, hutsik } = zinegotziBatu(udalak);
  const aurU = aurrekoak().filter(x => mota(x) === "municipales" && datuak(x));
  const aur = aurU.length && aurrekoak().length === osagaiak().length ? zinegotziBatu(aurU) : null;
  const bihurtu = (o) => Object.entries(o).sort(ordena).map(([g, n]) => [g, n, FAM[g] || FAM.LOCAL, short(g)]);
  if (h.t || h.zona) {  // un herrialde o un bloque (CAV, Iparralde): sus concejales
    const lurrak = h.t ? [h.t] : Object.keys(lur).filter(t => LUR_ZONA[t] === h.zona);
    const batu = (o) => { const m = {}; for (const t of lurrak) for (const [g, n] of Object.entries((o || {})[t] || {})) m[g] = (m[g] || 0) + n; return m; };
    const c = bihurtu(batu(lur)), n = c.reduce((s, y) => s + y[1], 0);
    return n ? `<section class="erakundea"><div class="lbl">${T.zinegotziak} · ${esc(h.t ? lurIzena(h.t) : eremuIzena(h.zona))} · ${fmt(n)}</div>${zerrenda(c, 0, aur ? batu(aur.lur) : null)}
      <p class="hint">${T.zinegotziHautatu}</p></section>` : "";
  }
  const N = Object.values(eh).reduce((a, b) => a + b, 0);
  const lerroak = Object.keys(lur).filter(t => t !== "?").map(t => { const c = bihurtu(lur[t]), n = c.reduce((s, y) => s + y[1], 0);
    return `<div class="barr"><span class="bn">${esc(lurIzena(t))} <b>${fmt(n)}</b></span><span class="bc">${c.map(([, m, kol, iz]) => `<i style="background:${kol};flex:${m}" title="${iz} ${m}">${m >= n * .08 ? m : ""}</i>`).join("")}</span></div>`; }).join("");
  return `<section class="erakundea"><div class="lbl">${T.zinegotziakEH} · ${fmt(N)}</div>${zerrenda(bihurtu(eh), 0, aur ? aur.eh : null)}
    <div class="lbl">${T.herrialdeka}</div>${lerroak}${hutsik ? `<p class="hint">${hutsik} ${T.zinegotzirikEzN}</p>` : ""}
    <p class="hint">${T.zinegotziHautatu}</p></section>`;
}
function eserlekuakOrria() {
  // Lo mismo que se analiza en «Emaitzak»: la elección o combinación que se ve y lo seleccionado en el mapa.
  // «Azkenak»: los concejales vienen en el fichero combinado; los escaños, en cada convocatoria que lo forma
  const k = state.hauteskundea, azk = zona(k) === "Azkenak", kk = osagaiak(k), h = hautaketa();
  let html = (state.mapa === "autonomikoak" ? federalaLaburpena(azk ? [k] : kk, h) : "") + zinegotziak(azk ? [k] : kk, h);
  for (const x of kk) for (const e of (ESERLEKUAK[x] || [])) html += erakundeaHTML(e, x, h);
  const oharrak = [];
  const ipa = h.zona ? h.zona === "Iparralde" : h.t ? ["Lapurdi", "Behe Nafarroa", "Zuberoa"].includes(h.t) : true;
  if (ipa && kk.some(x => zona(x) === "Iparralde" && mota(x) !== "municipales")) oharrak.push(T.eserlekuIparralde);
  if (kk.some(x => mota(x) === "europeas")) oharrak.push(T.eserlekuEuropa);
  const non = h.izena ? esc(h.muni ? h.izena : h.izena) : "";
  return `<div class="hdr"><div><h2>${T.eserlekuak}</h2><div class="meta">${non ? non + " · " : ""}${izena(k)}${osag().izena ? ` + ${osag().izena}` : ""}</div></div></div>${html}${oharrak.map(o => `<p class="hint">${o}</p>`).join("")}` +
    (!html ? `<p class="hint">${h.t || h.zona ? T.eserlekurikEzHemen : T.eserlekurikEz}</p>` : "");
}
// Pestañas del panel
function fitxaAldatu(f) {
  state.fitxa = f;
  document.querySelectorAll("#hudfitxak [role=tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.fitxa === f));
  arnasa().then(() => { if (state.fitxa === f) margotu(); });  // primero se ve la pestaña marcada; luego su contenido (INP)
}
document.querySelectorAll("#hudfitxak [role=tab]").forEach(b => { b.setAttribute("aria-selected", b.dataset.fitxa === state.fitxa); b.addEventListener("click", () => fitxaAldatu(b.dataset.fitxa)); });
// ---- Bilakaera: cómo ha votado una zona desde 2011 (pestaña del panel de la derecha) ----
// Los datos están en data/bilakaera/ (scripts/web_bilakaera.py): <id>.json cada municipio; maila/<nivel>.json las zonas
// de un nivel agregado (territorios, comarcas…) y maila/eh.json el total. Todas sus elecciones, con el % (y los escaños)
// de cada familia. Se ve por tipo de mapa (Udalak, Autonomikoak…), el del mapa por defecto.
const BILAKAERA = {};  // fichero → datos (o null si no hay)
let bilKat = null;     // tipo elegido en la ficha; null = el del mapa
let bilMota = null;    // dentro del tipo, la elección (p. ej. legislativas o presidenciales en Iparralde)
const BIL_GUTXIENEZ = 4, BIL_LERRO_MAX = 7;  // una familia sale en el gráfico si llega al 4 % alguna vez; como mucho 7

// Lo que enseña la ficha: el municipio de lo seleccionado (un municipio o una de sus secciones / bulegos), la zona del
// nivel del mapa (Bizkaia, Busturialdea…) o, sin nada elegido, el total. {fitx, gakoa (zona dentro del fichero), maila}
function bilHautaketa() {
  const id = state.hautatua;
  if (!id) return { fitx: "maila/eh", gakoa: "EH", maila: "eh" };
  if (String(id).includes("|")) { const l = mailaAktiboa(); return LEVELS[l] ? { fitx: `maila/${l}`, gakoa: String(id), maila: l } : null; }
  const h = hautaketa(); return h.muni && MUNIS[h.muni] ? { fitx: h.muni, gakoa: null, maila: "muni" } : null;
}
function bilKargatu(fitx) {
  if (fitx in BILAKAERA) return;
  BILAKAERA[fitx] = undefined;  // cargando
  load(`data/bilakaera/${fitx}.json`).then((d) => { BILAKAERA[fitx] = d; }).catch(() => { BILAKAERA[fitx] = null; })
    .then(() => { if (state.fitxa === "bilakaera") margotu(); });
}
const bilIzena = (f, kat) => f === "LOCAL" ? (kat === "udal" ? T.tokikoak : T.gainontzekoak) : famIzena(f);
// El total y las zonas de toda Euskal Herria en sus primeras elecciones (2011) no cubren toda la zona: el quinto campo
// dice lo que cubren (["Hegoalde"], ["Nafarroa", "Iparralde"]…). Clave para no unirlas con las demás, y su texto
const bilGakoa = (e) => (e && e[4] || []).join("+");
const bilEstaldura = (e) => e && e[4] ? T.bilBakarrik(e[4].map(z => T.zonak[z] || T.zonaLabur[z] || z).join(" + ")) : "";

// Gráfico de líneas: x = fecha de cada elección, y = % (escala común); punto con <title> en cada elección (hueco si la
// elección no cubre toda la zona: no se une con las que sí)
function bilGrafikoa(ks, h, lerroak, kat) {
  const W = 340, H = 180, ML = 30, MR = 16, MT = 10, MB = 22;
  const x0 = dataZ(ks[0]), x1 = dataZ(ks[ks.length - 1]), xs = (k) => ks.length === 1 ? (ML + W - MR) / 2 : ML + (W - ML - MR) * (dataZ(k) - x0) / (x1 - x0);
  const ymax = Math.max(10, Math.ceil(Math.max(...lerroak.flatMap(f => ks.map(k => bilPct(h[k], f) || 0))) / 10) * 10);
  const ys = (v) => MT + (H - MT - MB) * (1 - v / ymax);
  let s = "";
  for (let v = 0; v <= ymax; v += ymax > 50 ? 20 : 10) s += `<line class="bil-grid" x1="${ML}" x2="${W - MR}" y1="${ys(v)}" y2="${ys(v)}"/><text class="bil-ax" x="${ML - 4}" y="${ys(v) + 3}" text-anchor="end">${v}</text>`;
  // años: uno por año, bajo su primera elección, y sin pisarse (diciembre de 2015 y junio de 2016 quedan muy cerca), como
  // en nazioenbehatokia
  let azkenX = -Infinity;
  for (const u of new Set(ks.map(k => urtea(k).slice(0, 4)))) {
    const x = xs(ks.find(k => urtea(k).startsWith(u))); if (x - azkenX < 26) continue;
    s += `<text class="bil-ax" x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle">${u}</text>`; azkenX = x;
  }
  for (const f of lerroak) {
    const kol = FAM[f] || FAM.LOCAL, pts = ks.map(k => [k, bilPct(h[k], f)]).filter(p => p[1] != null);
    // la línea se corta donde la familia no se presentó y donde cambia lo que cubre la elección: tramos de elecciones seguidas
    const tramoak = [[]];
    ks.forEach((k, i) => { const v = bilPct(h[k], f); if (v == null || (i && bilGakoa(h[k]) !== bilGakoa(h[ks[i - 1]]))) tramoak.push([]); if (v != null) tramoak[tramoak.length - 1].push([k, v]); });
    for (const t of tramoak) if (t.length > 1) s += `<polyline class="bil-l" stroke="${kol}" points="${t.map(([k, v]) => `${xs(k).toFixed(1)},${ys(v).toFixed(1)}`).join(" ")}"/>`;
    for (const [k, v] of pts) { const est = bilEstaldura(h[k]);
      s += `<circle class="bil-p" cx="${xs(k).toFixed(1)}" cy="${ys(v).toFixed(1)}" r="3.2" fill="${kol}"${est ? ` style="fill:var(--panel-solid);stroke:${kol}"` : ""}><title>${bilIzena(f, kat)} · ${izena(k)}${est ? ` (${est})` : ""}: ${pct(v)}</title></circle>`; }
  }
  return `<svg class="bil-graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="${T.bilakaeraGrafikoa}">${s}</svg>`;
}
const bilPct = (e, f) => { if (!e) return null; const r = e[3].find(x => x[0] === f); return r ? r[1] : null; };  // null: no se presentó

function bilakaeraOrria() {
  const b = bilHautaketa();
  if (!b) return `<div class="hdr"><div><h2>${T.bilakaera}</h2></div></div><p class="hint">${T.bilakaeraHautatu}</p>`;
  bilKargatu(b.fitx);
  const f = BILAKAERA[b.fitx], d = f && b.gakoa ? f[b.gakoa] : f;
  const id = state.hautatua, muni = b.maila === "muni";
  const izenburua = muni ? NAME[b.fitx] || esc(MUNIS[b.fitx].n) : b.maila === "eh" ? "Euskal Herria" : NAME[id] || esc(String(id).split("|")[1]);
  const meta = muni ? esc(lurIzena(MUNIS[b.fitx].t || "")) : b.maila === "eh" ? "" : esc(T.mailak[b.maila] || LEVELS[b.maila]);
  const buru = `<div class="hdr"><div><h2>${izenburua}</h2><div class="meta">${meta ? meta + " · " : ""}${T.bilakaera}</div></div></div>`;
  if (f === undefined) return buru + `<p class="hint">${T.kargatzen}</p>`;
  if (!d) return buru + `<p class="hint">${T.daturikEz}</p>`;
  // el total y las zonas de toda Euskal Herria van por mapa (cada elección con sus complementos); el resto, por elección
  const hOf = (t) => d.hk ? d.hk[t] || {} : d.h;
  const katak = KATS.filter(t => INDEX.kategoriak[t].some(k => hOf(t)[k]));
  if (!katak.length) return buru + `<p class="hint">${T.daturikEz}</p>`;
  const kat = katak.includes(bilKat || state.mapa) ? (bilKat || state.mapa) : katak[0], H = hOf(kat);
  let ks = INDEX.kategoriak[kat].filter(k => H[k]).sort((a, b) => dataZ(a) - dataZ(b));
  // Varias elecciones en el mismo tipo (Iparralde: legislativas y presidenciales…): una línea por elección, no mezcladas
  const motak = [...new Set(ks.map(mota))];
  const zenbat = (m) => ks.filter(k => mota(k) === m).length;
  const m = motak.includes(bilMota) ? bilMota : motak.includes(mota(state.hauteskundea)) ? mota(state.hauteskundea) : motak.slice().sort((a, b) => zenbat(b) - zenbat(a))[0];
  if (motak.length > 1) ks = ks.filter(k => mota(k) === m);
  const azpi = motak.length > 1 ? `<div class="chips bil-katak bil-motak" role="group">${motak.map(x => `<button type="button" class="chip" data-bilmota="${x}" aria-pressed="${x === m}">${T.mota[x] || x}</button>`).join("")}</div>` : "";
  const chips = `<div class="chips bil-katak" role="group" aria-label="${T.hauteskundeMotak}">${katak.map(t => `<button type="button" class="chip" data-bilkat="${t}" aria-pressed="${t === kat}">${T.kat[t] || t}</button>`).join("")}</div>`;
  // familias del gráfico: las que llegan al 4 % alguna vez, por su máximo
  const max = {}; for (const k of ks) for (const [f, p] of H[k][3]) max[f] = Math.max(max[f] || 0, p);
  const lerroak = Object.keys(max).filter(f => max[f] >= BIL_GUTXIENEZ).sort((a, b) => max[b] - max[a]).slice(0, BIL_LERRO_MAX)
    .sort((a, b) => (bilPct(H[ks[ks.length - 1]], b) ?? -1) - (bilPct(H[ks[ks.length - 1]], a) ?? -1));  // leyenda: por el último resultado
  const azkena = ks[ks.length - 1], aurrekoa = ks[ks.length - 2];
  // Δ solo entre elecciones que cubren lo mismo
  const legenda = lerroak.map(f => { const v = bilPct(H[azkena], f), a = aurrekoa && bilGakoa(H[aurrekoa]) === bilGakoa(H[azkena]) ? bilPct(H[aurrekoa], f) : null;
    return `<div class="bil-leg"><i class="sq" style="background:${FAM[f] || FAM.LOCAL}"></i><span class="nm">${bilIzena(f, kat)}</span><span class="num">${pct(v)}</span>${a != null && v != null ? dfmt(v - a) : "<span></span>"}</div>`; }).join("");
  const udal = kat === "udal";
  const taula = `<div class="bil-taula${udal ? " udal" : ""}"><span class="h">${T.hauteskundea}</span><span class="h">${T.irabazlea}</span><span class="h num">${T.partaidetza}</span>${udal ? `<span class="h num">${T.zinegotziakLabur}</span>` : ""}` +
    ks.slice().reverse().map(k => { const [part, , esc_, c] = H[k], g = c[0];
      const ez = udal && g && g[2] != null && esc_ ? `${g[2]} / ${esc_}` : "–";
      const est = bilEstaldura(H[k]);
      return `<span class="nm">${izena(k)}${est ? ` <small class="bil-est">${est}</small>` : ""}</span><span class="nm"><i class="sq" style="background:${g ? FAM[g[0]] || FAM.LOCAL : "transparent"}"></i> ${g ? bilIzena(g[0], kat) : "–"}${g ? ` <small>${pct(g[1])}</small>` : ""}</span><span class="num">${pct(part)}</span>${udal ? `<span class="num">${ez}</span>` : ""}`; }).join("") + "</div>";
  return buru + chips + azpi + `<div class="lbl">${T.bozkenEhunekoa} · ${ks.length} ${T.hauteskundeN}</div>${bilGrafikoa(ks, H, lerroak, kat)}` +
    `<div class="lbl">${izena(azkena)}${aurrekoa ? ` · Δ ${izena(aurrekoa)}` : ""}</div>${legenda}<div class="lbl">${T.hauteskundez}</div>${taula}` +
    (ks.some(k => H[k][4]) ? `<p class="hint">${T.bilOsatugabe}</p>` : "") +
    (["territorio", "eremua", "eh"].includes(b.maila) ? `<p class="hint">${T.bilCera}</p>` : "");
}
// Cambio de tipo dentro de la ficha (delegado: el panel se repinta entero)
$("#body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-bilkat]"), m = e.target.closest("[data-bilmota]");
  if (b) { bilKat = b.dataset.bilkat; bilMota = null; margotu(); } else if (m) { bilMota = m.dataset.bilmota; margotu(); }
});
// ---- Euskal Parlamentu Federala: simulación con los votos de las elecciones «Autonomikoak» ----
// Cada herrialde elige sus escaños (FEDERALA.eserlekuak) con d'Hondt y barrera (FEDERALA.langa) sobre los votos
// a candidaturas: Hegoalde por partidos, Iparralde por bloques. En el hemiciclo y en el juego de la coalición los
// escaños se agrupan por bloque (es un parlamento de toda Euskal Herria). Las listas sin clasificar no forman grupo.
const FED_N = Object.values(FEDERALA.eserlekuak).reduce((a, b) => a + b, 0), FED_GEHIENGOA = Math.floor(FED_N / 2) + 1;
// Los escaños de Iparralde salen de un bloque, no de un partido: en la lista de cada grupo van con la sigla con la
// que el bloque se presenta allí (EH Bai, PS, RN…), junto a los partidos de Hegoalde y aparte de ellos
const fedSigla = (f) => INDEX.blokeak.includes(f) ? esc((INDEX.blokeSigla || {})[f] || f) : short(f);
function fedDhondt(botoak, n, guztira) {
  const sartu = Object.entries(botoak).filter(([, v]) => v >= FEDERALA.langa * guztira);
  const zatiak = sartu.flatMap(([k, v]) => Array.from({ length: n }, (_, i) => [v / (i + 1), v, k])).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const out = {}; for (const [, , k] of zatiak.slice(0, n)) out[k] = (out[k] || 0) + 1; return out;
}
function federala(k) {  // {herrialdeak: [{t, n, c: {alderdia: eserlekuak}}], taldeak: {blokea: {n, alderdiak: {…}}}}
  const kk = Array.isArray(k) ? k : [k];  // las elecciones que forman lo que se ve
  const herrialdeak = [], taldeak = {};
  for (const [t, n] of Object.entries(FEDERALA.eserlekuak)) {
    const r = kk.map(x => datuak(x) && datuak(x).agg.territorio && datuak(x).agg.territorio[`${t}|${t}`]).find(Boolean);
    if (!r) { herrialdeak.push({ t, n, c: {}, hutsik: true }); continue; }
    const botoak = {}; let guztira = 0;
    for (const c of r.c) { guztira += c[2]; if (c[1] !== "LOCAL") botoak[c[1]] = (botoak[c[1]] || 0) + c[2]; }
    const c = fedDhondt(botoak, n, guztira);
    herrialdeak.push({ t, n, c });
    for (const [f, e] of Object.entries(c)) {
      const b = blokea(f), g = taldeak[b] = taldeak[b] || { n: 0, alderdiak: {} };
      g.n += e; g.alderdiak[f] = (g.alderdiak[f] || 0) + e;
    }
  }
  return { herrialdeak, taldeak };
}
// En la pestaña Eserlekuak del mapa Autonomikoak, con la combinación que marca la línea de tiempo: con Euskal Herria
// entera, el parlamento y el juego «Egin zure gobernu koalizioa»; con un herrialde, sus escaños. Variación respecto
// a las anteriores de cada pieza.
let fedKoalizioa = new Set(), fedAukerak = false;
function federalaLaburpena(kk, h = {}) {
  const f = federala(kk), aurK = aurrekoak().filter(datuak);
  const aur = aurK.length === osagaiak().length ? federala(aurK) : null;
  if (h.t && FEDERALA.eserlekuak[h.t]) {
    const hr = f.herrialdeak.find(x => x.t === h.t), ha = aur && aur.herrialdeak.find(x => x.t === h.t);
    if (!hr || hr.hutsik) return "";
    const c = Object.entries(hr.c).sort(ordena).map(([g, n]) => [g, n, FAM[g] || FAM.LOCAL, short(g)]);
    return `<section class="erakundea"><div class="lbl">${T.fedIzena} · ${esc(lurIzena(h.t))}</div>${hemizikloa(c)}${zerrenda(c, 0, ha && !ha.hutsik ? ha.c : null)}</section>`;
  }
  if (h.zona) {  // la CAV o Iparralde: la suma de sus herrialdes
    const nireak = (ff) => ff.herrialdeak.filter(x => LUR_ZONA[x.t] === h.zona && !x.hutsik);
    const batu = (ff) => { const m = {}; for (const x of nireak(ff)) for (const [g, n] of Object.entries(x.c)) m[g] = (m[g] || 0) + n; return m; };
    if (!nireak(f).length) return "";
    const c = Object.entries(batu(f)).sort(ordena).map(([g, n]) => [g, n, FAM[g] || FAM.LOCAL, short(g)]);
    return `<section class="erakundea"><div class="lbl">${T.fedIzena} · ${esc(eremuIzena(h.zona))}</div>${hemizikloa(c)}${zerrenda(c, 0, aur && nireak(aur).length ? batu(aur) : null)}</section>`;
  }
  if (h.t || !Object.keys(f.taldeak).length) return "";
  const ordenatuak = Object.entries(f.taldeak).sort((a, b) => ordena([a[0], a[1].n], [b[0], b[1].n]));
  for (const b of [...fedKoalizioa]) if (!f.taldeak[b]) fedKoalizioa.delete(b);  // grupos que ya no están (otra fecha)
  const kide = (b) => fedKoalizioa.has(b), lortuak = ordenatuak.filter(([b]) => kide(b)).reduce((s, [, g]) => s + g.n, 0);
  const gehiengoa = lortuak >= FED_GEHIENGOA;
  const c = ordenatuak.map(([b, g]) => [b, g.n, kide(b) || !fedKoalizioa.size ? (FAM[b] || FAM.LOCAL) : FEDERALA.kanpokoa, short(b)]);
  const aurMapa = aur ? Object.fromEntries(Object.entries(aur.taldeak).map(([b, g]) => [b, g.n])) : null;
  let aukerak = "";
  if (fedAukerak) {  // coaliciones mínimas ganadoras: suman mayoría y no sobra ningún socio
    const g = ordenatuak.map(([b, x]) => [b, x.n]), out = [];
    for (let m = 1; m < 1 << g.length; m++) {
      const kideak = g.filter((_, i) => m & (1 << i)), n = kideak.reduce((s, x) => s + x[1], 0);
      if (n >= FED_GEHIENGOA && kideak.every(([, e]) => n - e < FED_GEHIENGOA)) out.push([kideak.map(x => x[0]), n]);
    }
    out.sort((a, b) => a[0].length - b[0].length || a[1] - b[1]);
    aukerak = out.map(([bs, n]) => `<button class="fed-aukera" data-bs="${esc(bs.join("|"))}">${bs.map(b => `<i class="sq" style="background:${FAM[b] || FAM.LOCAL}"></i>${short(b)}`).join(" + ")} <b>${n}</b></button>`).join("");
  }
  return `<section class="erakundea fed"><div class="lbl">${T.fedIzena} · ${T.fedSimulazioa}</div>${hemizikloa(c)}
    <div class="lbl">${T.fedJolastu}</div>
    <div class="fed-neurgailua" role="meter" aria-valuemin="0" aria-valuemax="${FED_N}" aria-valuenow="${lortuak}" aria-label="${T.fedKoalizioa}">
      <i style="width:${100 * lortuak / FED_N}%" class="${gehiengoa ? "on" : ""}"></i><span class="marra-g" style="left:${100 * FED_GEHIENGOA / FED_N}%"></span></div>
    <p class="fed-egoera ${gehiengoa ? "on" : ""}">${!fedKoalizioa.size ? T.fedHasi : gehiengoa ? `${T.fedLortuta} · ${lortuak} / ${FED_N}` : `${lortuak} / ${FED_GEHIENGOA} · ${T.fedFalta} ${FED_GEHIENGOA - lortuak}`}</p>
    <div class="fed-taldeak" role="group" aria-label="${T.fedTaldeak}">
      ${ordenatuak.map(([b, g]) => `<button class="fed-taldea" data-b="${esc(b)}" aria-pressed="${kide(b)}" style="--k:${FAM[b] || FAM.LOCAL}">
        <span class="fk-n">${g.n}${aurMapa ? " " + dsfmt(g.n - (aurMapa[b] || 0)) : ""}</span><span class="fk-b">${short(b)}</span>
        <span class="fk-a">${Object.entries(g.alderdiak).sort((x, y) => y[1] - x[1]).map(([fa, e]) => `${fedSigla(fa)} ${e}`).join(" · ")}</span></button>`).join("")}
    </div>
    <div class="fed-ekintzak"><button class="ibtn" id="fedgarbitu">${T.fedGarbitu}</button><button class="ibtn" id="fedtxikiak" aria-pressed="${fedAukerak}">${T.fedTxikienak}</button></div>
    ${aukerak}
    <details class="barrutiak"><summary>${T.herrialdeka}</summary>${f.herrialdeak.map(hh => { const cc = Object.entries(hh.c).sort((a, b) => ordena([blokea(a[0]), a[1]], [blokea(b[0]), b[1]]));
      return `<div class="barr"><span class="bn">${esc(lurIzena(hh.t))} <b>${hh.n}</b></span><span class="bc">${hh.hutsik ? `<em>${T.daturikEz}</em>` : cc.map(([fa, e]) => `<i style="background:${FAM[fa] || FAM.LOCAL};flex:${e}" title="${fedSigla(fa)} ${e}">${e}</i>`).join("")}</span></div>`; }).join("")}</details>
    <p class="hint">${T.fedMetodoa}</p></section>`;
}
// Juego de la coalición (dentro del panel): se reconstruye el panel en cada clic
document.addEventListener("click", (e) => {
  const t = e.target.closest("#hud .fed-taldea, #hud #fedgarbitu, #hud #fedtxikiak, #hud .fed-aukera"); if (!t) return;
  const lehen = [...fedKoalizioa].length;
  if (t.classList.contains("fed-taldea")) { const b = t.dataset.b; if (fedKoalizioa.has(b)) fedKoalizioa.delete(b); else fedKoalizioa.add(b); }
  else if (t.id === "fedgarbitu") fedKoalizioa.clear();
  else if (t.id === "fedtxikiak") fedAukerak = !fedAukerak;
  else fedKoalizioa = new Set(t.dataset.bs.split("|"));
  const k = state.hauteskundea, f = federala(zona(k) === "Azkenak" ? [k] : osagaiak(k));
  const n = [...fedKoalizioa].reduce((s, b) => s + ((f.taldeak[b] || {}).n || 0), 0);
  if (n >= FED_GEHIENGOA && fedKoalizioa.size !== lehen) abisua(`${T.fedLortuta}: ${n}`);
  margotu();
});
// ---- arranque ----
// botones de modo según el estado inicial (puede venir de un enlace)
document.querySelectorAll(".mode[data-mode]").forEach(x => x.setAttribute("aria-pressed", x.dataset.mode === state.modua));
await prestatu();
// El panel y el desplegable no dependen del mapa: se pintan en cuanto están los datos, sin esperar a
// que carguen las capas (en móvil o con mala conexión el mapa tarda más)
// municipio o eremu seleccionado en el enlace: el panel lo enseña ya (los enclaves, solo si la elección los incluye)
const S0 = ENKLABEAK.includes(String(URL0.get("s")).slice(0, 5)) && !enklabeakDaude() ? null : URL0.get("s");
if (S0 && (NAME[S0] || erregistroa(mailaAktiboa(), S0))) state.hautatua = S0;
hautatzaileakMargotu(); margotu();
let arrancado = false;
function arrancar() {
  if (arrancado) return; arrancado = true;
  zikindu(); ezarriMaila(); margotu();
  if (state.hautatua) hautatu(state.hautatua);  // resaltarlo en el mapa
  if (GEO.muni.features.length) udalerrira();
}
// Enlace a un municipio sin la posición del mapa (p, que se escribe al moverlo): se va a él como con el buscador; si no,
// el mapa se quedaría en los territorios, donde el panel no lo encuentra («sin datos»)
let udalerriraJoanda = false;
function udalerrira() {
  if (udalerriraJoanda) return; udalerriraJoanda = true;
  const s = String(S0 || ""), posizioa = POS_URL.length === 3 && POS_URL.every(Number.isFinite);
  if (state.hautatua === S0 && !posizioa && /^(\d{5}|FR\d{5})$/.test(s)) joan("muni", s);
}
if (estiloaPrest) arrancar(); else map.once("style.load", arrancar);  // sin esperar a las teselas (ver 03-mapa.js)
// Después del primer pintado: contornos municipales (buscador, nivel municipal, límites) y escaños
load("geo/udalerriak.geojson").then((g) => {
  for (const f of g.features) { f.properties.fid = f.id; NAME[f.id] = esc(f.properties.name); }
  GEO.muni = g; bilatzaileaBete();
  const iturria = map.getSource("muga-udal"); if (iturria) iturria.setData(g);
  // municipio del enlace: hasta ahora no se sabía si existía (los nombres llegan con este fichero)
  if (S0 && !state.hautatua && NAME[S0]) state.hautatua = S0;
  zikindu(); if (arrancado) ezarriMaila(); margotu();
  if (state.hautatua === S0 && arrancado) hautatu(S0);
  if (arrancado) udalerrira();
});
// se repinta si el mapa ya arrancó (si no, lo hará arrancar())
mailaKargatu("eskualdea").then(() => { if (arrancado) ezarriMaila(); });  // comarcas: listas para cuando se acerque
load("data/eserlekuak.json").then((e) => { ESERLEKUAK = e; if (state.fitxa === "eserlekuak") margotu(); }).catch(() => {});
if (URL0.get("a") === "federala") aldatuMapa("autonomikoak").then(() => fitxaAldatu("eserlekuak"));  // enlaces antiguos al parlamento federal
})();
