"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import {
  cadastrarUnidadeEquipamento,
  definirPlanoEquipamento,
  encaminharAvisoEquipamento,
  registrarManutencaoEquipamento,
} from "@/lib/actions/equipamentos";
import { ESTADO_INICIAL, type EstadoAcao } from "@/lib/erros";
import { DECISOES_AVISO, ROTULO_DECISAO, ROTULO_TIPO, TIPOS_MANUTENCAO, type TipoManutencao } from "@/lib/equipamentos/avisos";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { Input } from "@/components/ui/input";

const selectClass = "mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-2 text-sm";
const labelClass = "block text-sm font-medium";

type Acao = (estado: EstadoAcao, form: FormData) => Promise<EstadoAcao>;

function Formulario({ acao, titulo, botao, children }: { acao: Acao; titulo: string; botao: string; children: ReactNode }) {
  const [estado, enviar] = useActionState(acao, ESTADO_INICIAL);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (estado.ok) ref.current?.reset(); }, [estado]);
  return (
    <form ref={ref} action={enviar} className="space-y-3">
      <p className="text-sm font-semibold">{titulo}</p>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Salvando…">{botao}</SubmitButton>
        <MensagemAcao estado={estado} />
      </div>
    </form>
  );
}

function SeletorTipo({ padrao = "calibracao" }: { padrao?: TipoManutencao }) {
  return (
    <label className={labelClass}>
      Tipo
      <select name="tipo" defaultValue={padrao} className={selectClass} required>
        {TIPOS_MANUTENCAO.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
      </select>
    </label>
  );
}

export function NovaUnidadeForm({ equipamentos }: { equipamentos: { id: number; nome: string }[] }) {
  return (
    <Formulario acao={cadastrarUnidadeEquipamento} titulo="Cadastrar unidade física" botao="Cadastrar unidade">
      <label className={`${labelClass} sm:col-span-2`}>
        Equipamento
        <select name="equipamento_id" defaultValue="" className={selectClass} required>
          <option value="" disabled>Escolha do catálogo de equipamentos</option>
          {equipamentos.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </label>
      <label className={labelClass}>Patrimônio<Input name="codigo_patrimonio" maxLength={80} className="mt-1" /></label>
      <label className={labelClass}>Número de série<Input name="numero_serie" maxLength={80} className="mt-1" /></label>
      <label className={labelClass}>Fabricante<Input name="fabricante" maxLength={120} className="mt-1" /></label>
      <label className={labelClass}>Modelo<Input name="modelo" maxLength={120} className="mt-1" /></label>
    </Formulario>
  );
}

export function RegistrarManutencaoForm({ unidadeId }: { unidadeId: number }) {
  return (
    <Formulario acao={registrarManutencaoEquipamento} titulo="Registrar manutenção ou calibração" botao="Registrar">
      <input type="hidden" name="equipamento_unidade_id" value={unidadeId} />
      <SeletorTipo />
      <label className={labelClass}>
        Situação
        <select name="situacao" defaultValue="concluida" className={selectClass} required>
          <option value="concluida">Já foi feita</option>
          <option value="agendada">Está agendada</option>
        </select>
      </label>
      <label className={labelClass}>Data<Input name="data" type="date" required className="mt-1" /></label>
      <label className={labelClass}>
        Próxima data (opcional)
        <Input name="proxima_data" type="date" className="mt-1" />
      </label>
      <label className={labelClass}>Responsável / empresa<Input name="tecnico_responsavel" maxLength={120} className="mt-1" /></label>
      <label className={labelClass}>Certificado ou laudo nº<Input name="numero_documento" maxLength={120} className="mt-1" /></label>
      <label className={`${labelClass} sm:col-span-2`}>Observação<Input name="descricao" maxLength={1000} className="mt-1" /></label>
    </Formulario>
  );
}

export function PlanoManutencaoForm({ unidadeId, antecedenciaPadrao }: { unidadeId: number; antecedenciaPadrao: number }) {
  return (
    <Formulario acao={definirPlanoEquipamento} titulo="Definir frequência e aviso" botao="Salvar plano">
      <input type="hidden" name="equipamento_unidade_id" value={unidadeId} />
      <SeletorTipo />
      <label className={labelClass}>
        A cada quantos dias
        <Input name="periodicidade_dias" type="number" min={1} max={3650} step={1} required className="mt-1" placeholder="365" />
      </label>
      <label className={labelClass}>
        Avisar com quantos dias de antecedência
        <Input name="antecedencia_aviso_dias" type="number" min={0} max={730} step={1} className="mt-1" placeholder={String(antecedenciaPadrao)} />
      </label>
      <label className="flex items-center gap-2 text-sm sm:self-end">
        <input type="checkbox" name="obrigatorio" defaultChecked className="accent-primary" />
        Obrigatório (exigência de qualidade)
      </label>
    </Formulario>
  );
}

export function EncaminharAvisoForm({ unidadeId, tipo, vencimento }: { unidadeId: number; tipo: TipoManutencao; vencimento: string | null }) {
  return (
    <Formulario acao={encaminharAvisoEquipamento} titulo="Registrar encaminhamento" botao="Registrar encaminhamento">
      <input type="hidden" name="equipamento_unidade_id" value={unidadeId} />
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="vencimento" value={vencimento ?? ""} />
      <label className={labelClass}>
        O que foi decidido
        <select name="decisao" defaultValue="" className={selectClass} required>
          <option value="" disabled>Escolha</option>
          {DECISOES_AVISO.map((d) => <option key={d} value={d}>{ROTULO_DECISAO[d]}</option>)}
        </select>
      </label>
      <label className={labelClass}>Observação<Input name="observacao" maxLength={1000} required className="mt-1" /></label>
    </Formulario>
  );
}
