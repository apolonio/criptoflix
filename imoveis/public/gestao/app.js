(function () {
  "use strict";

  const STORAGE_KEY = "gestao-casa:v1";
  const DOCUMENT_DB_NAME = "gestao-casa-files";
  const DOCUMENT_STORE_NAME = "documents";
  const MAX_PDF_SIZE = 10 * 1024 * 1024;
  const MONEY_FORMATTER = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
  const MONTH_FORMATTER = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

  const modules = {
    dashboard: "Dashboard",
    properties: "Imóveis",
    movements: "Movimentações",
    maintenance: "Manutenções/Benfeitorias",
    documents: "Documentos",
    taxes: "Obrigações fiscais",
    contracts: "Contratos/Locações",
    reports: "Relatórios",
    people: "Pessoas e acessos",
    settings: "Configurações",
  };

  const localStorageAdapter = {
    load() {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    save(data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    },
    clear() {
      localStorage.removeItem(STORAGE_KEY);
    },
  };

  const documentFileStore = {
    open() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DOCUMENT_DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(DOCUMENT_STORE_NAME)) {
            db.createObjectStore(DOCUMENT_STORE_NAME, { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    },
    async put(id, file) {
      if (state.remoteReady) {
        const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "content-type": "application/pdf" },
          body: file,
        });
        if (!response.ok) throw new Error(await responseError(response));
        return;
      }
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(DOCUMENT_STORE_NAME, "readwrite");
        transaction.objectStore(DOCUMENT_STORE_NAME).put({
          id,
          blob: file,
          name: file.name,
          type: file.type || "application/pdf",
          size: file.size,
          updatedAt: new Date().toISOString(),
        });
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      });
    },
    async get(id) {
      if (state.remoteReady) {
        const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!response.ok) return null;
        const blob = await response.blob();
        return { id, blob, type: blob.type || "application/pdf", size: blob.size };
      }
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(DOCUMENT_STORE_NAME, "readonly");
        const request = transaction.objectStore(DOCUMENT_STORE_NAME).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      });
    },
  };

  const state = {
    activeModule: "dashboard",
    period: currentMonth(),
    data: migrateData(localStorageAdapter.load() || seedData()),
    remoteReady: false,
    profile: null,
    people: [],
    remoteSaveTimer: null,
  };

  const content = document.querySelector("#content");
  const moduleTitle = document.querySelector("#module-title");
  const periodFilter = document.querySelector("#period-filter");
  const dialog = document.querySelector("#entity-dialog");
  const dialogForm = document.querySelector("#entity-form");
  const dialogTitle = document.querySelector("#dialog-title");
  const dialogEyebrow = document.querySelector("#dialog-eyebrow");
  const dialogBody = document.querySelector("#dialog-body");
  const dialogSubmit = document.querySelector("#dialog-submit");
  const storageStatus = document.querySelector("#storage-status");
  const accountSummary = document.querySelector("#account-summary");
  const accountName = document.querySelector("#account-name");
  const accountRole = document.querySelector("#account-role");

  periodFilter.value = state.period;

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeModule = button.dataset.module;
      render();
    });
  });

  document.querySelector("#refresh-data").addEventListener("click", () => refreshSharedData(true));
  document.querySelector("#new-movement-top").addEventListener("click", () => openMovementDialog());
  periodFilter.addEventListener("change", () => {
    state.period = periodFilter.value || currentMonth();
    render();
  });

  dialogForm.addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const handler = dialogForm.dataset.handler;
    if (dialogHandlers[handler]) dialogHandlers[handler](new FormData(dialogForm));
  });

  saveAndRender();
  connectSharedStorage();

  function render() {
    moduleTitle.textContent = modules[state.activeModule];
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.classList.toggle("active", button.dataset.module === state.activeModule);
    });

    const renderers = {
      dashboard: renderDashboard,
      properties: renderProperties,
      movements: renderMovements,
      maintenance: renderMaintenance,
      documents: renderDocuments,
      taxes: renderTaxes,
      contracts: renderContracts,
      reports: renderReports,
      people: renderPeople,
      settings: renderSettings,
    };

    content.innerHTML = "";
    content.append(renderers[state.activeModule]());
  }

  function renderDashboard() {
    const wrap = fragment();
    const monthMovements = filterByMonth(state.data.movements, state.period);
    const consolidated = consolidatedProperties();
    const active = consolidated.filter((property) => !["Vendido/Inativo", "Fora do consolidado"].includes(property.status));
    const revenue = sum(monthMovements.filter((item) => item.type === "Receita"), "amount");
    const expenses = sum(monthMovements.filter((item) => item.type === "Despesa"), "amount");
    const equity = sum(active, "estimatedValue");
    const acquisition = sum(active, "acquisitionValue");
    const comparable = active.filter((property) => Number(property.acquisitionValue || 0) > 0);
    const comparableCurrent = sum(comparable, "estimatedValue");
    const appreciation = comparableCurrent - acquisition;
    const pendingDocs = state.data.documents.filter((document) => document.status !== "Regular").length;

    wrap.append(patrimonyOverview(active, equity, acquisition, appreciation, comparable.length));
    wrap.append(
      summaryGrid([
        ["Receitas do mês", money(revenue), "Entradas no período selecionado"],
        ["Despesas do mês", money(expenses), "Custos, impostos e manutenções"],
        ["Resultado do mês", money(revenue - expenses), revenue - expenses >= 0 ? "Saldo positivo" : "Saldo negativo"],
        ["Documentos a acompanhar", String(pendingDocs), pendingDocs === 1 ? "Pendência documental" : "Pendências documentais"],
      ])
    );

    const charts = el("div", "dashboard-chart-grid");
    charts.append(cashFlowPanel(), periodBalancePanel(revenue, expenses));
    wrap.append(charts);
    wrap.append(propertyEvolutionPanel(active));

    const details = el("div", "two-column");
    details.append(recentMovementsPanel(monthMovements), esperancaPanel());
    wrap.append(details);
    return wrap;
  }

  function renderProperties() {
    const wrap = fragment();
    wrap.append(
      sectionHeader(
        "Imóveis",
        "Os imóveis cadastrados entram no consolidado conforme a seleção de cada registro.",
        "Novo imóvel",
        () => openPropertyDialog()
      )
    );

    const grid = el("div", "property-grid");
    state.data.properties.forEach((property) => grid.append(propertyCard(property)));
    wrap.append(grid);
    return wrap;
  }

  function renderMovements() {
    return renderTableModule({
      title: "Movimentações",
      description: "Receitas e despesas ficam vinculadas a cada imóvel, sem apagar o histórico.",
      button: "Nova movimentação",
      onClick: () => openMovementDialog(),
      empty: "Nenhuma movimentação cadastrada.",
      headers: ["Data", "Imóvel", "Tipo", "Categoria", "Descrição", "Valor"],
      rows: state.data.movements.map((movement) => [
        date(movement.date),
        propertyName(movement.propertyId),
        movement.type,
        movement.category,
        movement.description,
        amountCell(movement.amount, movement.type === "Receita"),
      ]),
    });
  }

  function renderMaintenance() {
    return renderTableModule({
      title: "Manutenções/Benfeitorias",
      description: "Manutenção e investimento ficam separados para relatório e valorização futura.",
      button: "Novo lançamento",
      onClick: () => openMaintenanceDialog(),
      empty: "Nenhuma manutenção ou benfeitoria cadastrada.",
      headers: ["Data", "Imóvel", "Tipo", "Descrição", "Valor", "Status"],
      rows: state.data.maintenance.map((item) => [
        date(item.date),
        propertyName(item.propertyId),
        item.kind,
        item.description,
        amountCell(item.amount, false),
        item.status,
      ]),
    });
  }

  function renderDocuments() {
    return renderTableModule({
      title: "Documentos",
      description: "Matrículas, escrituras, recibos, boletos e outros comprovantes em PDF por imóvel.",
      button: "Novo documento",
      onClick: () => openDocumentDialog(),
      empty: "Nenhum documento cadastrado.",
      headers: ["Imóvel", "Tipo", "Nome", "Data", "Status", "Arquivo PDF", "Ações"],
      rows: state.data.documents.map((item) => [
        propertyName(item.propertyId),
        item.kind,
        item.name,
        date(item.date),
        item.status,
        documentFileSummary(item),
        documentActions(item),
      ]),
    });
  }

  function renderTaxes() {
    return renderTableModule({
      title: "Obrigações fiscais",
      description: "Controle de IPTU, ITR, CCIR, taxas e vencimentos por imóvel.",
      button: "Nova obrigação",
      onClick: () => openTaxDialog(),
      empty: "Nenhuma obrigação fiscal cadastrada.",
      headers: ["Vencimento", "Imóvel", "Tributo", "Competência", "Valor", "Status"],
      rows: state.data.taxes.map((tax) => [
        date(tax.dueDate),
        propertyName(tax.propertyId),
        tax.kind,
        tax.year,
        amountCell(tax.amount, false),
        tax.status,
      ]),
    });
  }

  function renderContracts() {
    return renderTableModule({
      title: "Contratos/Locações",
      description: "Contratos ficam ligados ao imóvel e alimentam relatórios de receita.",
      button: "Novo contrato",
      onClick: () => openContractDialog(),
      empty: "Nenhum contrato cadastrado.",
      headers: ["Imóvel", "Pessoa/Empresa", "Tipo", "Início", "Fim", "Valor", "Status"],
      rows: state.data.contracts.map((contract) => [
        propertyName(contract.propertyId),
        contract.party,
        contract.kind,
        date(contract.startDate),
        date(contract.endDate),
        amountCell(contract.amount, true),
        contract.status,
      ]),
    });
  }

  function renderReports() {
    const wrap = fragment();
    const byProperty = state.data.properties.map((property) => {
      const movements = state.data.movements.filter((movement) => movement.propertyId === property.id);
      const revenue = sum(movements.filter((movement) => movement.type === "Receita"), "amount");
      const expenses = sum(movements.filter((movement) => movement.type === "Despesa"), "amount");
      return { property, revenue, expenses, result: revenue - expenses };
    });

    wrap.append(
      sectionHeader(
        "Relatórios",
        "Consolidado financeiro por imóvel, respeitando as seleções de cada cadastro."
      )
    );

    const reports = el("div", "two-column");
    const propertyPanel = panel("Resultado por imóvel");
    const propertyList = el("ul", "report-list");
    byProperty.forEach(({ property, revenue, expenses, result }) => {
      propertyList.append(
        listItem(
          `${property.name}${property.includeInConsolidated ? "" : " · fora do consolidado"}`,
          `${money(revenue)} receitas · ${money(expenses)} despesas · ${money(result)} líquido`
        )
      );
    });
    propertyPanel.append(propertyList);

    const architecturePanel = panel("Dados compartilhados e preparados para evolução");
    architecturePanel.append(
      paragraph(
        "Quando publicado, o sistema sincroniza os registros entre as pessoas autorizadas. A organização dos dados continua compatível com uma migração futura para PostgreSQL."
      )
    );
    reports.append(propertyPanel, architecturePanel);
    wrap.append(reports);
    return wrap;
  }

  function renderPeople() {
    const wrap = fragment();
    const canManage = state.profile?.role === "admin";
    wrap.append(
      sectionHeader(
        "Pessoas e acessos",
        "Cadastre quem pode consultar ou administrar o patrimônio da família.",
        canManage ? "Cadastrar pessoa" : "",
        canManage ? () => openPersonDialog() : null
      )
    );

    if (!state.remoteReady) {
      const notice = panel("Disponível na versão compartilhada");
      notice.append(
        paragraph(
          "O cadastro de acessos é protegido e fica disponível quando você entra na versão publicada do Gestão Casa."
        )
      );
      wrap.append(notice);
      return wrap;
    }

    wrap.append(
      renderTableModule({
        title: "Usuários autorizados",
        description: canManage
          ? "O e-mail cadastrado deve ser o mesmo usado pela pessoa ao entrar."
          : "Seu perfil permite consultar os dados, sem alterar acessos.",
        empty: "Nenhuma pessoa cadastrada.",
        headers: ["Nome completo", "Login", "E-mail", "Telefone", "Perfil", "Status"],
        rows: state.people.map((person) => [
          person.fullName,
          person.login,
          person.email,
          person.phone || "-",
          badge(person.role === "admin" ? "Administrador" : "Consulta", person.role === "admin" ? "gold" : ""),
          badge(person.status === "active" ? "Ativo" : "Inativo", person.status === "active" ? "" : "muted"),
        ]),
      })
    );
    return wrap;
  }

  function renderSettings() {
    const wrap = fragment();
    wrap.append(sectionHeader("Configurações", "Exportação, importação e cópia de segurança dos dados."));

    const panelEl = panel(state.remoteReady ? "Dados compartilhados" : "Dados locais");
    const actions = el("div", "settings-actions");
    const exportButton = button("Exportar JSON", "primary-button", exportData);
    actions.append(exportButton);
    if (canEdit()) {
      actions.append(
        button("Importar JSON", "ghost-button", importData),
        button("Restaurar dados iniciais", "danger-button", resetData)
      );
    }
    panelEl.append(
      paragraph(
        state.remoteReady
          ? "Os dados estão sincronizados com o Site e podem ser consultados pelas pessoas autorizadas. Uma cópia local continua disponível neste navegador."
          : "Esta versão preserva o funcionamento local: os dados ficam salvos neste navegador até a conexão com o Site ficar disponível."
      ),
      actions
    );
    wrap.append(panelEl);

    const mapPanel = panel("Modelo preparado");
    const list = el("ul", "area-list");
    [
      "imoveis: status patrimonial, venda/inativação, valores e inclusão no consolidado",
      "imovel_imagens: até 3 imagens por imóvel, com uma capa e duas complementares",
      "areas_por_fonte: matrícula, CCIR, CAR e ITR sem sobrescrever informações",
      "movimentacoes: receitas e despesas individualizadas por imóvel",
      "documentos, obrigacoes_fiscais, contratos e manutencoes: registros vinculados ao imóvel",
      "pessoas_e_acessos: login, nome completo, e-mail, telefone, perfil e situação",
    ].forEach((item) => list.append(listItem(item, "")));
    mapPanel.append(list);
    wrap.append(mapPanel);
    return wrap;
  }

  function propertyCard(property) {
    const card = el("article", "property-card");
    const cover = el("div", "property-cover");
    const coverImage = property.images?.find((image) => image.role === "cover" && image.dataUrl);
    if (coverImage) {
      const img = document.createElement("img");
      img.src = coverImage.dataUrl;
      img.alt = `Imagem principal de ${property.name}`;
      cover.append(img);
    } else {
      cover.append(el("span", "", property.name));
    }

    const body = el("div", "property-body");
    const badges = el("div", "badge-row");
    badges.append(
      badge(property.status, property.includeInConsolidated ? "gold" : "muted"),
      badge(property.includeInConsolidated ? "Consolidado" : "Fora do consolidado")
    );

    const meta = el("div", "property-meta");
    meta.append(
      el("span", "", `${property.type} · ${property.city || "Localização a preencher"}`),
      el("span", "", `Valor estimado: ${money(property.estimatedValue)}`),
      el("span", "", `Titularidade: ${property.ownership}`)
    );

    const gallery = el("div", "gallery-strip");
    ["cover", "secondary", "third"].forEach((role, index) => {
      const slot = el("div", "gallery-slot");
      const image = property.images?.find((item) => item.role === role && item.dataUrl);
      if (image) {
        const img = document.createElement("img");
        img.src = image.dataUrl;
        img.alt = image.label;
        slot.append(img);
      } else {
        slot.textContent = index === 0 ? "Capa" : `Foto ${index + 1}`;
      }
      gallery.append(slot);
    });

    const actions = el("div", "card-actions");
    if (canEdit()) {
      actions.append(
        button("Editar", "small-button", () => openPropertyDialog(property)),
        button("Vender/Inativar", "small-button", () => openSaleDialog(property))
      );
    }

    body.append(badges, el("h3", "", property.name), meta, gallery, actions);
    card.append(cover, body);
    return card;
  }

  function recentPropertiesPanel() {
    const panelEl = panel("Imóveis consolidados");
    const list = el("ul", "report-list");
    consolidatedProperties().forEach((property) => {
      list.append(listItem(property.name, `${property.status} · ${money(property.estimatedValue)}`));
    });
    panelEl.append(list);
    return panelEl;
  }

  function patrimonyOverview(properties, currentValue, acquisitionValue, appreciation, comparableCount) {
    const overview = el("section", "patrimony-overview");
    const main = el("div", "patrimony-main");
    main.append(
      el("span", "patrimony-label", "Patrimônio consolidado atual"),
      el("strong", "patrimony-value", money(currentValue)),
      el("small", "", `${properties.length} imóveis ativos no consolidado`)
    );

    const details = el("div", "patrimony-details");
    details.append(
      patrimonyStat(
        "Valor de compra",
        money(acquisitionValue),
        `${comparableCount} de ${properties.length} imóveis informados`
      ),
      patrimonyStat(
        "Evolução comparável",
        comparableCount ? signedMoney(appreciation) : "Aguardando dados",
        comparableCount && acquisitionValue ? `${signedPercentage((appreciation / acquisitionValue) * 100)} sobre os valores informados` : "Preencha os valores de compra"
      ),
      patrimonyStat("Imóveis consolidados", String(properties.length), "Respeita a seleção de cada imóvel")
    );
    overview.append(main, details);
    return overview;
  }

  function patrimonyStat(label, value, hint) {
    const stat = el("div", "patrimony-stat");
    stat.append(el("span", "", label), el("strong", "", value), el("small", "", hint));
    return stat;
  }

  function cashFlowPanel() {
    const panelEl = panel("Receitas e despesas · 6 meses");
    const series = monthlyCashFlowSeries(6);
    const maximum = Math.max(...series.flatMap((item) => [item.revenue, item.expenses]), 0);
    const legend = el("div", "chart-legend");
    legend.append(chartLegendItem("Receitas", "revenue"), chartLegendItem("Despesas", "expense"));
    panelEl.querySelector(".panel-header").append(legend);

    if (!maximum) {
      panelEl.append(emptyState("Nenhuma receita ou despesa nos últimos seis meses."));
      return panelEl;
    }

    const chart = el("div", "cash-flow-chart");
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", "Comparação de receitas e despesas dos últimos seis meses");
    series.forEach((item) => {
      const group = el("div", "cash-flow-group");
      const bars = el("div", "cash-flow-bars");
      bars.append(
        chartBar(item.revenue, maximum, "revenue", `${item.label}: receitas ${money(item.revenue)}`),
        chartBar(item.expenses, maximum, "expense", `${item.label}: despesas ${money(item.expenses)}`)
      );
      group.append(bars, el("span", "cash-flow-label", item.label));
      chart.append(group);
    });

    panelEl.append(el("small", "chart-scale", `Maior movimento: ${money(maximum)}`), chart);
    return panelEl;
  }

  function periodBalancePanel(revenue, expenses) {
    const panelEl = panel("Composição do mês");
    const total = revenue + expenses;
    const revenueShare = total ? (revenue / total) * 100 : 0;
    const donut = el("div", "balance-donut");
    donut.style.background = total
      ? `conic-gradient(var(--forest-600) 0 ${revenueShare}%, var(--gold-500) ${revenueShare}% 100%)`
      : "var(--line)";
    donut.setAttribute("role", "img");
    donut.setAttribute("aria-label", total ? `Receitas ${Math.round(revenueShare)} por cento e despesas ${Math.round(100 - revenueShare)} por cento` : "Sem movimentações no mês");

    const center = el("div", "balance-center");
    center.append(el("span", "", "Resultado"), el("strong", revenue - expenses >= 0 ? "positive" : "negative", money(revenue - expenses)));
    donut.append(center);

    const values = el("div", "balance-values");
    values.append(
      balanceValue("Receitas", money(revenue), "revenue"),
      balanceValue("Despesas", money(expenses), "expense"),
      balanceValue("Margem do mês", revenue ? signedPercentage(((revenue - expenses) / revenue) * 100) : "Sem receitas", "result")
    );
    const body = el("div", "balance-layout");
    body.append(donut, values);
    panelEl.append(body);
    return panelEl;
  }

  function propertyEvolutionPanel(properties) {
    const panelEl = panel("Evolução por imóvel");
    const description = el("p", "panel-description", "Compare o valor de compra com o valor atual de cada imóvel consolidado.");
    panelEl.querySelector(".panel-header").append(description);

    const list = el("div", "asset-list");
    const header = el("div", "asset-row asset-header");
    ["Imóvel", "Compra", "Valor atual", "Evolução"].forEach((label) => header.append(el("span", "", label)));
    list.append(header);

    properties.forEach((property) => {
      const purchase = Number(property.acquisitionValue || 0);
      const current = Number(property.estimatedValue || 0);
      const delta = current - purchase;
      const row = el("div", "asset-row");
      const identity = el("div", "asset-identity");
      identity.append(el("strong", "", property.name), el("small", "", property.status));
      row.append(
        identity,
        el("span", purchase ? "" : "value-missing", purchase ? money(purchase) : "Não informado"),
        el("strong", "asset-current", money(current)),
        el("span", purchase ? (delta >= 0 ? "asset-positive" : "asset-negative") : "value-missing", purchase ? `${signedMoney(delta)} · ${signedPercentage((delta / purchase) * 100)}` : "Aguardando compra")
      );
      list.append(row);
    });

    const totalPurchase = sum(properties, "acquisitionValue");
    const comparable = properties.filter((property) => Number(property.acquisitionValue || 0) > 0);
    const comparableCurrent = sum(comparable, "estimatedValue");
    const footer = el("div", "asset-row asset-total");
    footer.append(
      el("strong", "", "Total consolidado"),
      el("strong", "", money(totalPurchase)),
      el("strong", "", money(sum(properties, "estimatedValue"))),
      el("strong", "", totalPurchase ? `${signedMoney(comparableCurrent - totalPurchase)} · ${signedPercentage(((comparableCurrent - totalPurchase) / totalPurchase) * 100)}` : "Aguardando valores")
    );
    list.append(footer);
    panelEl.append(list);
    return panelEl;
  }

  function monthlyCashFlowSeries(count) {
    const [year, month] = state.period.split("-").map(Number);
    return Array.from({ length: count }, (_, index) => {
      const point = new Date(Date.UTC(year, month - count + index, 1));
      const key = `${point.getUTCFullYear()}-${String(point.getUTCMonth() + 1).padStart(2, "0")}`;
      const movements = filterByMonth(state.data.movements, key);
      return {
        key,
        label: MONTH_FORMATTER.format(point).replace(".", ""),
        revenue: sum(movements.filter((item) => item.type === "Receita"), "amount"),
        expenses: sum(movements.filter((item) => item.type === "Despesa"), "amount"),
      };
    });
  }

  function chartBar(value, maximum, modifier, label) {
    const bar = el("div", `cash-flow-bar ${modifier}`);
    bar.style.height = value ? `${Math.max(5, (value / maximum) * 100)}%` : "0";
    bar.title = label;
    bar.setAttribute("aria-label", label);
    return bar;
  }

  function chartLegendItem(label, modifier) {
    const item = el("span", "chart-legend-item");
    item.append(el("i", modifier), document.createTextNode(label));
    return item;
  }

  function balanceValue(label, value, modifier) {
    const item = el("div", "balance-value");
    const labelWrap = el("span", "");
    labelWrap.append(el("i", modifier), document.createTextNode(label));
    item.append(labelWrap, el("strong", "", value));
    return item;
  }

  function recentMovementsPanel(movements) {
    const panelEl = panel("Movimentações do período");
    if (!movements.length) {
      panelEl.append(emptyState("Nenhuma movimentação neste mês."));
      return panelEl;
    }
    const list = el("ul", "report-list");
    movements.slice(0, 6).forEach((movement) => {
      list.append(
        listItem(
          `${date(movement.date)} · ${propertyName(movement.propertyId)}`,
          `${movement.type} · ${movement.category} · ${money(movement.amount)}`
        )
      );
    });
    panelEl.append(list);
    return panelEl;
  }

  function esperancaPanel() {
    const property = state.data.properties.find((item) => item.slug === "sitio-exemplo");
    const panelEl = panel("Sítio de Exemplo · demonstração");
    const list = el("ul", "area-list");
    property.areaSources.forEach((area) => {
      list.append(listItem(area.source, `${area.value} ${area.unit} · ${area.note}`));
    });
    panelEl.append(
      paragraph(
        "A ficha aceita múltiplas áreas por fonte documental, sem substituir uma informação pela outra."
      ),
      list
    );
    return panelEl;
  }

  function renderTableModule(config) {
    const wrap = fragment();
    wrap.append(sectionHeader(config.title, config.description, config.button, config.onClick));
    if (!config.rows.length) {
      wrap.append(emptyState(config.empty));
      return wrap;
    }

    const tableWrap = el("div", "table-wrap");
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    config.headers.forEach((header) => headerRow.append(el("th", "", header)));
    thead.append(headerRow);
    const tbody = document.createElement("tbody");
    config.rows.forEach((row) => {
      const tr = document.createElement("tr");
      row.forEach((cell) => {
        const td = document.createElement("td");
        if (cell instanceof Node) td.append(cell);
        else td.textContent = cell || "-";
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(thead, tbody);
    tableWrap.append(table);
    wrap.append(tableWrap);
    return wrap;
  }

  function documentFileSummary(item) {
    if (!item.fileId) return el("span", "file-empty", "Sem arquivo");
    const summary = el("div", "file-summary");
    summary.append(el("strong", "", item.fileName || "Documento.pdf"));
    summary.append(el("small", "", formatFileSize(item.fileSize)));
    return summary;
  }

  function documentActions(item) {
    const actions = el("div", "document-actions");
    if (canEdit()) actions.append(button("Editar", "small-button", () => openDocumentDialog(item)));
    if (item.fileId) {
      actions.append(button("Abrir", "small-button", () => openDocumentFile(item, false)));
      actions.append(button("Baixar", "small-button", () => openDocumentFile(item, true)));
    } else if (canEdit()) {
      actions.append(button("Anexar PDF", "small-button", () => openDocumentDialog(item)));
    }
    return actions;
  }

  async function openDocumentFile(item, download) {
    const previewWindow = download ? null : window.open("about:blank", "_blank");
    try {
      const storedFile = await documentFileStore.get(item.fileId);
      if (!storedFile?.blob) {
        previewWindow?.close();
        alert("O arquivo PDF não foi encontrado neste navegador.");
        return;
      }

      const url = URL.createObjectURL(storedFile.blob);
      if (download) {
        const link = document.createElement("a");
        link.href = url;
        link.download = item.fileName || storedFile.name || "documento.pdf";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (previewWindow) {
        previewWindow.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        URL.revokeObjectURL(url);
        alert("O navegador bloqueou a abertura do PDF. Permita pop-ups para visualizar o arquivo.");
      }
    } catch {
      previewWindow?.close();
      alert("Não foi possível abrir o PDF neste navegador.");
    }
  }

  function openPropertyDialog(property = null) {
    openDialog({
      handler: "property",
      title: property ? "Editar imóvel" : "Novo imóvel",
      eyebrow: "Imóveis",
      submit: "Salvar imóvel",
      body: propertyForm(property),
      context: property?.id || "",
    });
  }

  function propertyForm(property) {
    const data = property || {
      name: "",
      type: "Casa",
      city: "",
      status: "Ativo",
      ownership: "Pessoa Física",
      acquisitionDate: "",
      acquisitionValue: "",
      estimatedValue: "",
      includeInConsolidated: true,
      notes: "",
      images: defaultImages(),
    };

    return `
      <div class="form-grid">
        ${field("Nome do imóvel", "name", "text", data.name, true)}
        ${selectField("Tipo", "type", ["Casa", "Apartamento", "Lote", "Loja", "Sítio", "Outro"], data.type)}
        ${field("Cidade/UF", "city", "text", data.city)}
        ${selectField("Status patrimonial", "status", ["Ativo", "Em regularização", "Posse a apurar", "Vendido/Inativo", "Fora do consolidado"], data.status)}
        ${selectField("Titularidade", "ownership", ["Pessoa Física", "Cônjuge", "Copropriedade", "Holding", "Espólio"], data.ownership)}
        ${field("Data de aquisição", "acquisitionDate", "date", data.acquisitionDate)}
        ${field("Valor de aquisição", "acquisitionValue", "number", data.acquisitionValue)}
        ${field("Valor estimado atual", "estimatedValue", "number", data.estimatedValue)}
        <label class="checkbox-field full"><input type="checkbox" name="includeInConsolidated" ${data.includeInConsolidated ? "checked" : ""}> Entra no patrimônio consolidado</label>
        <div class="field full">
          <label>Observações</label>
          <textarea name="notes">${escapeHtml(data.notes || "")}</textarea>
        </div>
      </div>
      <h3>Imagens do imóvel</h3>
      <div class="image-input-grid">
        ${imageUploader(data, "cover", "Imagem principal/capa")}
        ${imageUploader(data, "secondary", "Imagem complementar 1")}
        ${imageUploader(data, "third", "Imagem complementar 2")}
      </div>
    `;
  }

  function imageUploader(property, role, label) {
    const image = property.images?.find((item) => item.role === role);
    const preview = image?.dataUrl
      ? `<img src="${image.dataUrl}" alt="${escapeHtml(label)}">`
      : `<span>${escapeHtml(label)}</span>`;
    return `
      <label class="image-uploader">
        <strong>${escapeHtml(label)}</strong>
        <span class="image-preview" data-preview="${role}">${preview}</span>
        <input type="file" name="image-${role}" accept="image/*" data-image-input="${role}">
        <input type="hidden" name="image-current-${role}" value="${escapeHtml(image?.dataUrl || "")}">
      </label>
    `;
  }

  function openMovementDialog() {
    openDialog({
      handler: "movement",
      title: "Nova movimentação",
      eyebrow: "Receitas e despesas",
      submit: "Salvar movimentação",
      body: `
        <div class="form-grid">
          ${selectField("Imóvel", "propertyId", propertyOptions(), "")}
          ${selectField("Tipo", "type", ["Receita", "Despesa"], "Despesa")}
          ${field("Data", "date", "date", today(), true)}
          ${field("Categoria", "category", "text", "Manutenção", true)}
          ${field("Valor", "amount", "number", "", true)}
          ${field("Descrição", "description", "text", "", true)}
        </div>
      `,
    });
  }

  function openMaintenanceDialog() {
    openDialog({
      handler: "maintenance",
      title: "Nova manutenção/benfeitoria",
      eyebrow: "Manutenções",
      submit: "Salvar lançamento",
      body: `
        <div class="form-grid">
          ${selectField("Imóvel", "propertyId", propertyOptions(), "")}
          ${selectField("Tipo", "kind", ["Manutenção", "Benfeitoria/Investimento"], "Manutenção")}
          ${field("Data", "date", "date", today(), true)}
          ${field("Valor", "amount", "number", "", true)}
          ${selectField("Status", "status", ["Planejado", "Em andamento", "Concluído"], "Concluído")}
          ${field("Descrição", "description", "text", "", true)}
        </div>
      `,
    });
  }

  function openDocumentDialog(item = null) {
    openDialog({
      handler: "document",
      title: item ? "Editar documento" : "Novo documento",
      eyebrow: "Documentos",
      submit: "Salvar documento",
      context: item?.id || "",
      body: `
        <div class="form-grid">
          ${selectField("Imóvel", "propertyId", propertyOptions(), item?.propertyId || "")}
          ${selectField("Tipo", "kind", ["Matrícula", "Escritura", "Recibo", "Boleto", "CCIR", "CAR", "ITR", "Contrato", "Comprovante", "Outro"], item?.kind || "Matrícula")}
          ${field("Nome", "name", "text", item?.name || "", true)}
          ${field("Data", "date", "date", item?.date || today())}
          ${selectField("Status", "status", ["Regular", "Pendente", "A revisar", "Vencido"], item?.status || "Regular")}
          ${field("Observação", "notes", "text", item?.notes || "")}
          <div class="field full pdf-field">
            <label for="document-file">Arquivo PDF</label>
            <input id="document-file" name="documentFile" type="file" accept="application/pdf,.pdf">
            <small>${item?.fileName ? `Arquivo atual: ${escapeHtml(item.fileName)} (${formatFileSize(item.fileSize)})` : "Selecione um PDF de até 10 MB."}</small>
          </div>
        </div>
      `,
    });
  }

  function openTaxDialog() {
    openDialog({
      handler: "tax",
      title: "Nova obrigação fiscal",
      eyebrow: "Fiscal",
      submit: "Salvar obrigação",
      body: `
        <div class="form-grid">
          ${selectField("Imóvel", "propertyId", propertyOptions(), "")}
          ${selectField("Tributo/Obrigação", "kind", ["IPTU", "ITR", "CCIR", "Taxa", "Outro"], "ITR")}
          ${field("Competência", "year", "number", new Date().getFullYear(), true)}
          ${field("Vencimento", "dueDate", "date", today(), true)}
          ${field("Valor", "amount", "number", "", true)}
          ${selectField("Status", "status", ["A vencer", "Pago", "Vencido", "Isento"], "A vencer")}
        </div>
      `,
    });
  }

  function openContractDialog() {
    openDialog({
      handler: "contract",
      title: "Novo contrato/locação",
      eyebrow: "Contratos",
      submit: "Salvar contrato",
      body: `
        <div class="form-grid">
          ${selectField("Imóvel", "propertyId", propertyOptions(), "")}
          ${field("Pessoa/Empresa", "party", "text", "", true)}
          ${selectField("Tipo", "kind", ["Aluguel", "Arrendamento", "Comodato", "Prestação de serviço", "Outro"], "Aluguel")}
          ${field("Início", "startDate", "date", today(), true)}
          ${field("Fim", "endDate", "date", "")}
          ${field("Valor mensal/contratual", "amount", "number", "", true)}
          ${selectField("Status", "status", ["Ativo", "Encerrado", "Em negociação"], "Ativo")}
        </div>
      `,
    });
  }

  function openPersonDialog() {
    openDialog({
      handler: "person",
      title: "Cadastrar pessoa",
      eyebrow: "Pessoas e acessos",
      submit: "Liberar acesso",
      body: `
        <div class="form-grid">
          ${field("Login", "login", "text", "", true)}
          ${field("Nome completo", "fullName", "text", "", true)}
          ${field("E-mail", "email", "email", "", true)}
          ${field("Telefone", "phone", "tel", "")}
          ${selectField("Perfil de acesso", "role", [
            { value: "viewer", label: "Consulta" },
            { value: "admin", label: "Administrador" },
          ], "viewer")}
        </div>
        <p class="form-note">A pessoa deverá entrar com este mesmo e-mail. Não armazenamos senhas no Gestão Casa.</p>
      `,
    });
  }

  function openSaleDialog(property) {
    openDialog({
      handler: "sale",
      title: `Vender/Inativar ${property.name}`,
      eyebrow: "Histórico patrimonial",
      submit: "Registrar sem apagar",
      context: property.id,
      body: `
        <div class="form-grid">
          ${field("Data da venda/inativação", "saleDate", "date", today(), true)}
          ${field("Valor de venda", "saleValue", "number", property.saleValue || "")}
          ${selectField("Novo status", "status", ["Vendido/Inativo", "Fora do consolidado", "Posse a apurar"], "Vendido/Inativo")}
          <div class="field full">
            <label>Observação histórica</label>
            <textarea name="notes">${escapeHtml(property.notes || "")}</textarea>
          </div>
        </div>
      `,
    });
  }

  function openDialog(config) {
    dialogForm.dataset.handler = config.handler;
    dialogForm.dataset.context = config.context || "";
    dialogTitle.textContent = config.title;
    dialogEyebrow.textContent = config.eyebrow;
    dialogSubmit.textContent = config.submit;
    dialogBody.innerHTML = config.body;
    dialogBody.querySelectorAll("[data-image-input]").forEach((input) => {
      input.addEventListener("change", () => previewImage(input));
    });
    dialog.showModal();
  }

  const dialogHandlers = {
    async property(formData) {
      const id = dialogForm.dataset.context || createId("property");
      const previous = state.data.properties.find((property) => property.id === id);
      const images = await collectImages(formData, previous, id);
      const property = {
        id,
        slug: previous?.slug || slugify(formData.get("name")),
        name: stringValue(formData, "name"),
        type: stringValue(formData, "type"),
        city: stringValue(formData, "city"),
        status: stringValue(formData, "status"),
        ownership: stringValue(formData, "ownership"),
        acquisitionDate: stringValue(formData, "acquisitionDate"),
        acquisitionValue: numberValue(formData, "acquisitionValue"),
        estimatedValue: numberValue(formData, "estimatedValue"),
        includeInConsolidated: formData.get("includeInConsolidated") === "on",
        notes: stringValue(formData, "notes"),
        images,
        areaSources: previous?.areaSources || [],
        timeline: previous?.timeline || [],
      };

      upsert(state.data.properties, property);
      closeDialogAndSave();
    },
    movement(formData) {
      state.data.movements.unshift({
        id: createId("movement"),
        propertyId: stringValue(formData, "propertyId"),
        type: stringValue(formData, "type"),
        date: stringValue(formData, "date"),
        category: stringValue(formData, "category"),
        amount: numberValue(formData, "amount"),
        description: stringValue(formData, "description"),
      });
      closeDialogAndSave();
    },
    maintenance(formData) {
      const item = {
        id: createId("maintenance"),
        propertyId: stringValue(formData, "propertyId"),
        kind: stringValue(formData, "kind"),
        date: stringValue(formData, "date"),
        amount: numberValue(formData, "amount"),
        status: stringValue(formData, "status"),
        description: stringValue(formData, "description"),
      };
      state.data.maintenance.unshift(item);
      state.data.movements.unshift({
        id: createId("movement"),
        propertyId: item.propertyId,
        type: "Despesa",
        date: item.date,
        category: item.kind,
        amount: item.amount,
        description: item.description,
      });
      closeDialogAndSave();
    },
    async document(formData) {
      const id = dialogForm.dataset.context || createId("document");
      const previous = state.data.documents.find((item) => item.id === id);
      const file = formData.get("documentFile");

      try {
        if (file?.size) {
          const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
          if (!isPdf) {
            alert("Selecione um arquivo no formato PDF.");
            return;
          }
          if (file.size > MAX_PDF_SIZE) {
            alert("O PDF deve ter no máximo 10 MB.");
            return;
          }
          await documentFileStore.put(id, file);
        }

        upsert(state.data.documents, {
          id,
          propertyId: stringValue(formData, "propertyId"),
          kind: stringValue(formData, "kind"),
          name: stringValue(formData, "name"),
          date: stringValue(formData, "date"),
          status: stringValue(formData, "status"),
          notes: stringValue(formData, "notes"),
          fileId: file?.size ? id : previous?.fileId || "",
          fileName: file?.size ? file.name : previous?.fileName || "",
          fileSize: file?.size ? file.size : previous?.fileSize || 0,
          fileType: file?.size ? "application/pdf" : previous?.fileType || "",
        });
        closeDialogAndSave();
      } catch {
        alert("Não foi possível salvar o PDF. Verifique o arquivo e tente novamente.");
      }
    },
    async person(formData) {
      try {
        const response = await fetch("/api/users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            login: stringValue(formData, "login"),
            fullName: stringValue(formData, "fullName"),
            email: stringValue(formData, "email"),
            phone: stringValue(formData, "phone"),
            role: stringValue(formData, "role"),
          }),
        });
        if (!response.ok) throw new Error(await responseError(response));
        dialog.close();
        await loadPeople();
        render();
      } catch (error) {
        alert(error.message || "Não foi possível cadastrar esta pessoa.");
      }
    },
    tax(formData) {
      state.data.taxes.unshift({
        id: createId("tax"),
        propertyId: stringValue(formData, "propertyId"),
        kind: stringValue(formData, "kind"),
        year: stringValue(formData, "year"),
        dueDate: stringValue(formData, "dueDate"),
        amount: numberValue(formData, "amount"),
        status: stringValue(formData, "status"),
      });
      closeDialogAndSave();
    },
    contract(formData) {
      state.data.contracts.unshift({
        id: createId("contract"),
        propertyId: stringValue(formData, "propertyId"),
        party: stringValue(formData, "party"),
        kind: stringValue(formData, "kind"),
        startDate: stringValue(formData, "startDate"),
        endDate: stringValue(formData, "endDate"),
        amount: numberValue(formData, "amount"),
        status: stringValue(formData, "status"),
      });
      closeDialogAndSave();
    },
    sale(formData) {
      const property = state.data.properties.find((item) => item.id === dialogForm.dataset.context);
      if (!property) return;
      property.status = stringValue(formData, "status");
      property.saleDate = stringValue(formData, "saleDate");
      property.saleValue = numberValue(formData, "saleValue");
      property.includeInConsolidated = false;
      property.notes = stringValue(formData, "notes");
      property.timeline = property.timeline || [];
      property.timeline.unshift({
        date: property.saleDate,
        title: property.status,
        notes: `Registro histórico preservado. Valor informado: ${money(property.saleValue)}.`,
      });
      closeDialogAndSave();
    },
  };

  function closeDialogAndSave() {
    dialog.close();
    saveAndRender();
  }

  function saveAndRender() {
    localStorageAdapter.save(state.data);
    render();
    queueRemoteSave();
  }

  async function connectSharedStorage() {
    await refreshSharedData(false);
    if (state.remoteReady) await loadPeople();
    updateAccountUI();
    render();
  }

  async function refreshSharedData(showFeedback) {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = await response.json();
      state.remoteReady = true;
      state.profile = payload.profile;
      if (payload.data) {
        state.data = migrateData(payload.data);
        localStorageAdapter.save(state.data);
      } else {
        await saveRemoteData();
      }
      storageStatus.textContent = "Sincronizado com o Site";
      storageStatus.classList.add("synced");
      if (showFeedback) await loadPeople();
      updateAccountUI();
      render();
    } catch (error) {
      state.remoteReady = false;
      storageStatus.textContent = "Salvo neste navegador";
      storageStatus.classList.remove("synced");
      if (showFeedback) alert(error.message || "Não foi possível atualizar os dados compartilhados.");
      render();
    }
  }

  async function loadPeople() {
    const response = await fetch("/api/users", { cache: "no-store" });
    if (!response.ok) throw new Error(await responseError(response));
    const payload = await response.json();
    state.profile = payload.profile;
    state.people = payload.users || [];
    updateAccountUI();
  }

  function updateAccountUI() {
    if (!state.profile) {
      accountSummary.hidden = true;
      return;
    }
    accountSummary.hidden = false;
    accountName.textContent = state.profile.fullName;
    accountRole.textContent = state.profile.role === "admin" ? "Administrador" : "Consulta";
    document.querySelector("#new-movement-top").hidden = !canEdit();
  }

  function queueRemoteSave() {
    if (!state.remoteReady) return;
    clearTimeout(state.remoteSaveTimer);
    state.remoteSaveTimer = setTimeout(() => {
      saveRemoteData().catch((error) => {
        storageStatus.textContent = "Alteração salva apenas neste navegador";
        storageStatus.classList.remove("synced");
        console.error(error);
      });
    }, 350);
  }

  async function saveRemoteData() {
    const response = await fetch("/api/state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state.data),
    });
    if (!response.ok) throw new Error(await responseError(response));
    storageStatus.textContent = "Sincronizado com o Site";
    storageStatus.classList.add("synced");
  }

  async function responseError(response) {
    try {
      const payload = await response.json();
      return payload.error || `Erro ${response.status}`;
    } catch {
      return `Erro ${response.status}`;
    }
  }

  function collectImages(formData, previous, propertyId) {
    const roles = [
      ["cover", "Imagem principal/capa"],
      ["secondary", "Imagem complementar 1"],
      ["third", "Imagem complementar 2"],
    ];

    return Promise.all(
      roles.map(async ([role, label]) => {
        const file = formData.get(`image-${role}`);
        const current = formData.get(`image-current-${role}`) || "";
        const previousImage = previous?.images?.find((image) => image.role === role);
        let dataUrl = current || previousImage?.dataUrl || "";
        if (file && file.size) {
          if (file.size > 8 * 1024 * 1024) throw new Error("Cada imagem deve ter no máximo 8 MB.");
          if (state.remoteReady) {
            const imageId = `${propertyId}-${role}`;
            const response = await fetch(`/api/images/${encodeURIComponent(imageId)}`, {
              method: "PUT",
              headers: { "content-type": file.type || "image/jpeg" },
              body: file,
            });
            if (!response.ok) throw new Error(await responseError(response));
            dataUrl = `/api/images/${encodeURIComponent(imageId)}?v=${Date.now()}`;
          } else {
            dataUrl = await readFileAsDataUrl(file);
          }
        }
        return { role, label, dataUrl };
      })
    );
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function previewImage(input) {
    const role = input.dataset.imageInput;
    const preview = dialogBody.querySelector(`[data-preview="${role}"]`);
    const file = input.files?.[0];
    if (!file || !preview) return;
    readFileAsDataUrl(file).then((dataUrl) => {
      preview.innerHTML = `<img src="${dataUrl}" alt="Prévia da imagem">`;
      const current = dialogBody.querySelector(`[name="image-current-${role}"]`);
      if (current) current.value = dataUrl;
    });
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gestao-casa-${today()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importData() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          state.data = JSON.parse(reader.result);
          saveAndRender();
        } catch {
          alert("Não foi possível importar este arquivo.");
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  function resetData() {
    if (!confirm("Restaurar os dados iniciais do Gestão Casa?")) return;
    localStorageAdapter.clear();
    state.data = seedData();
    saveAndRender();
  }

  function seedData() {
    // Exemplo público, sem registros pessoais ou documentos reais.
    return {
      version: 1,
      properties: [
        {
          ...demoProperty("property-example", "Sítio de Exemplo", "Sítio", "Cidade/UF", 0),
          slug: "sitio-exemplo",
          notes: "Cadastro fictício para conhecer os recursos do sistema.",
        },
        demoProperty("property-01", "Imóvel 01", "Casa", "Cidade/UF", 0),
        demoProperty("property-02", "Imóvel 02", "Apartamento", "Cidade/UF", 0),
        demoProperty("property-03", "Imóvel 03", "Lote", "Cidade/UF", 0),
      ],
      movements: [],
      maintenance: [],
      documents: [],
      taxes: [],
      contracts: [],
    };
  }

  function demoProperty(id, name, type, city, value) {
    return {
      id,
      slug: slugify(name),
      name,
      type,
      city,
      status: "Ativo",
      ownership: "Pessoa Física",
      acquisitionDate: "",
      acquisitionValue: 0,
      estimatedValue: value,
      includeInConsolidated: true,
      notes: "Cadastro inicial aguardando documentação e valores reais.",
      images: defaultImages(),
      areaSources: [],
      timeline: [],
    };
  }

  function defaultImages() {
    return [
      { role: "cover", label: "Imagem principal/capa", dataUrl: "" },
      { role: "secondary", label: "Imagem complementar 1", dataUrl: "" },
      { role: "third", label: "Imagem complementar 2", dataUrl: "" },
    ];
  }

  function consolidatedProperties() {
    return state.data.properties.filter((property) => property.includeInConsolidated);
  }

  function filterByMonth(items, month) {
    return items.filter((item) => item.date?.startsWith(month));
  }

  function propertyName(id) {
    return state.data.properties.find((property) => property.id === id)?.name || "Imóvel não encontrado";
  }

  function propertyOptions() {
    return state.data.properties.map((property) => ({ value: property.id, label: property.name }));
  }

  function upsert(collection, item) {
    const index = collection.findIndex((entry) => entry.id === item.id);
    if (index >= 0) collection[index] = item;
    else collection.unshift(item);
  }

  function migrateData(data) {
    const recoveredProperties = {
      "property-01": { placeholder: "Imóvel 01", name: "Casa 01 - Herança", estimatedValue: 150000 },
      "property-02": { placeholder: "Imóvel 02", name: "Casa 02 - Paulo", estimatedValue: 150000 },
      "property-04": { placeholder: "Imóvel 04", name: "Casa 03 - Cida", estimatedValue: 150000 },
      "property-05": { placeholder: "Imóvel 05", name: "Loja ABC", estimatedValue: 250000 },
    };

    (data.properties || []).forEach((property) => {
      const recovery = recoveredProperties[property.id];
      if (recovery && property.name === recovery.placeholder && Number(property.estimatedValue || 0) === 0) {
        property.name = recovery.name;
        property.estimatedValue = recovery.estimatedValue;
      }
    });
    data.documents = data.documents || [];
    return data;
  }

  function sectionHeader(title, description, actionLabel, onClick) {
    const header = el("div", "section-header");
    const text = document.createElement("div");
    text.append(el("h2", "", title), el("p", "", description || ""));
    header.append(text);
    if (actionLabel && canEdit()) header.append(button(actionLabel, "primary-button", onClick));
    return header;
  }

  function canEdit() {
    return !state.remoteReady || state.profile?.role === "admin";
  }

  function summaryGrid(items) {
    const grid = el("div", "summary-grid");
    items.forEach(([label, value, hint]) => {
      const card = el("article", "metric-card");
      card.append(el("span", "", label), el("strong", "", value), el("small", "", hint));
      grid.append(card);
    });
    return grid;
  }

  function panel(title) {
    const panelEl = el("section", "panel");
    const header = el("div", "panel-header");
    header.append(el("h2", "", title));
    panelEl.append(header);
    return panelEl;
  }

  function listItem(left, right) {
    const li = document.createElement("li");
    li.append(el("span", "", left));
    if (right) li.append(el("strong", "", right));
    return li;
  }

  function badge(text, modifier = "") {
    return el("span", `badge ${modifier}`.trim(), text);
  }

  function paragraph(text) {
    return el("p", "muted-text", text);
  }

  function emptyState(text) {
    const template = document.querySelector("#empty-state-template").content.cloneNode(true);
    template.querySelector("span").textContent = text;
    return template;
  }

  function amountCell(amount, positive) {
    return el("span", positive ? "amount-positive" : "amount-negative", money(amount));
  }

  function field(label, name, type, value = "", required = false) {
    return `
      <div class="field">
        <label>${escapeHtml(label)}</label>
        <input name="${name}" type="${type}" value="${escapeHtml(String(value || ""))}" ${required ? "required" : ""} ${type === "number" ? 'step="0.01"' : ""}>
      </div>
    `;
  }

  function selectField(label, name, options, selected) {
    const normalized = options.map((option) =>
      typeof option === "string" ? { value: option, label: option } : option
    );
    return `
      <div class="field">
        <label>${escapeHtml(label)}</label>
        <select name="${name}" required>
          ${normalized
            .map(
              (option) =>
                `<option value="${escapeHtml(option.value)}" ${option.value === selected ? "selected" : ""}>${escapeHtml(option.label)}</option>`
            )
            .join("")}
        </select>
      </div>
    `;
  }

  function button(label, className, onClick) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.textContent = label;
    element.addEventListener("click", onClick);
    return element;
  }

  function el(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== "") element.textContent = text;
    return element;
  }

  function fragment() {
    return document.createDocumentFragment();
  }

  function sum(items, key) {
    return items.reduce((total, item) => total + Number(item[key] || 0), 0);
  }

  function money(value) {
    return MONEY_FORMATTER.format(Number(value || 0));
  }

  function signedMoney(value) {
    const amount = Number(value || 0);
    if (!amount) return money(0);
    return `${amount > 0 ? "+" : "-"}${money(Math.abs(amount))}`;
  }

  function signedPercentage(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return "-";
    return `${amount > 0 ? "+" : ""}${amount.toFixed(1).replace(".", ",")}%`;
  }

  function formatFileSize(value) {
    const bytes = Number(value || 0);
    if (!bytes) return "Tamanho não informado";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  }

  function date(value) {
    if (!value) return "-";
    return DATE_FORMATTER.format(new Date(`${value}T00:00:00Z`));
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function currentMonth() {
    return new Date().toISOString().slice(0, 7);
  }

  function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function stringValue(formData, key) {
    return String(formData.get(key) || "").trim();
  }

  function numberValue(formData, key) {
    return Number(formData.get(key) || 0);
  }

  function slugify(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
})();
