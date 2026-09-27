export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      analises: {
        Row: {
          ativo: boolean
          codigo: string
          descricao: string | null
          nome: string | null
          nome_simplificado: string | null
          ofertavel: boolean
          status: string | null
        }
        Insert: {
          ativo?: boolean
          codigo: string
          descricao?: string | null
          nome?: string | null
          nome_simplificado?: string | null
          ofertavel?: boolean
          status?: string | null
        }
        Update: {
          ativo?: boolean
          codigo?: string
          descricao?: string | null
          nome?: string | null
          nome_simplificado?: string | null
          ofertavel?: boolean
          status?: string | null
        }
        Relationships: []
      }
      analises_matrizes_amostras: {
        Row: {
          ativo: boolean
          codigo_analise: string
          criado_em: string
          id: number
          matriz_codigo: string
          observacao: string | null
        }
        Insert: {
          ativo?: boolean
          codigo_analise: string
          criado_em?: string
          id?: number
          matriz_codigo: string
          observacao?: string | null
        }
        Update: {
          ativo?: boolean
          codigo_analise?: string
          criado_em?: string
          id?: number
          matriz_codigo?: string
          observacao?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analises_matrizes_amostras_codigo_analise_fkey"
            columns: ["codigo_analise"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "analises_matrizes_amostras_matriz_codigo_fkey"
            columns: ["matriz_codigo"]
            isOneToOne: false
            referencedRelation: "matrizes_amostras"
            referencedColumns: ["codigo"]
          },
        ]
      }
      auditoria: {
        Row: {
          acao: string
          criado_em: string
          id: number
          justificativa: string | null
          registro_id: string | null
          tabela: string
          usuario: string | null
          valor_anterior: Json | null
          valor_novo: Json | null
        }
        Insert: {
          acao: string
          criado_em?: string
          id?: never
          justificativa?: string | null
          registro_id?: string | null
          tabela: string
          usuario?: string | null
          valor_anterior?: Json | null
          valor_novo?: Json | null
        }
        Update: {
          acao?: string
          criado_em?: string
          id?: never
          justificativa?: string | null
          registro_id?: string | null
          tabela?: string
          usuario?: string | null
          valor_anterior?: Json | null
          valor_novo?: Json | null
        }
        Relationships: []
      }
      cadastros_triagem: {
        Row: {
          codigo: string
          codigo_normalizado: string
          criado_em: string
          criado_por: string | null
          dados_extraidos: Json
          entidade_id: number | null
          entidade_tipo: string | null
          formato: string | null
          id: number
          resolvido_em: string | null
          status: string
          tipo_sugerido: string | null
        }
        Insert: {
          codigo: string
          codigo_normalizado: string
          criado_em?: string
          criado_por?: string | null
          dados_extraidos?: Json
          entidade_id?: number | null
          entidade_tipo?: string | null
          formato?: string | null
          id?: never
          resolvido_em?: string | null
          status?: string
          tipo_sugerido?: string | null
        }
        Update: {
          codigo?: string
          codigo_normalizado?: string
          criado_em?: string
          criado_por?: string | null
          dados_extraidos?: Json
          entidade_id?: number | null
          entidade_tipo?: string | null
          formato?: string | null
          id?: never
          resolvido_em?: string | null
          status?: string
          tipo_sugerido?: string | null
        }
        Relationships: []
      }
      clientes: {
        Row: {
          ativo: boolean
          cnpj: string | null
          contato: string | null
          criado_em: string
          email: string | null
          endereco: string | null
          id: number
          nome: string
          observacoes: string | null
          telefone: string | null
        }
        Insert: {
          ativo?: boolean
          cnpj?: string | null
          contato?: string | null
          criado_em?: string
          email?: string | null
          endereco?: string | null
          id?: never
          nome: string
          observacoes?: string | null
          telefone?: string | null
        }
        Update: {
          ativo?: boolean
          cnpj?: string | null
          contato?: string | null
          criado_em?: string
          email?: string | null
          endereco?: string | null
          id?: never
          nome?: string
          observacoes?: string | null
          telefone?: string | null
        }
        Relationships: []
      }
      demanda_analises: {
        Row: {
          codigo_analise: string
          created_at: string
          demanda_id: number
          grupo_amostra_id: number | null
          id: number
          observacao: string | null
          origem_quantidade: string
          quantidade_amostras: number
          status_custeio: string
          updated_at: string
        }
        Insert: {
          codigo_analise: string
          created_at?: string
          demanda_id: number
          grupo_amostra_id?: number | null
          id?: never
          observacao?: string | null
          origem_quantidade?: string
          quantidade_amostras?: number
          status_custeio?: string
          updated_at?: string
        }
        Update: {
          codigo_analise?: string
          created_at?: string
          demanda_id?: number
          grupo_amostra_id?: number | null
          id?: never
          observacao?: string | null
          origem_quantidade?: string
          quantidade_amostras?: number
          status_custeio?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demanda_analises_codigo_analise_fkey"
            columns: ["codigo_analise"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "demanda_analises_demanda_id_fkey"
            columns: ["demanda_id"]
            isOneToOne: false
            referencedRelation: "demandas_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demanda_analises_grupo_amostra_id_fkey"
            columns: ["grupo_amostra_id"]
            isOneToOne: false
            referencedRelation: "demanda_grupos_amostras"
            referencedColumns: ["id"]
          },
        ]
      }
      demanda_grupos_amostras: {
        Row: {
          created_at: string
          demanda_id: number
          id: number
          identificacao: string
          observacao: string | null
          ordem: number
          quantidade_amostras: number
          tipo_matriz: string | null
          unidade: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          demanda_id: number
          id?: number
          identificacao: string
          observacao?: string | null
          ordem?: number
          quantidade_amostras?: number
          tipo_matriz?: string | null
          unidade?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          demanda_id?: number
          id?: number
          identificacao?: string
          observacao?: string | null
          ordem?: number
          quantidade_amostras?: number
          tipo_matriz?: string | null
          unidade?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demanda_grupos_amostras_demanda_id_fkey"
            columns: ["demanda_id"]
            isOneToOne: false
            referencedRelation: "demandas_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demanda_grupos_amostras_tipo_matriz_fkey"
            columns: ["tipo_matriz"]
            isOneToOne: false
            referencedRelation: "matrizes_amostras"
            referencedColumns: ["codigo"]
          },
        ]
      }
      demandas_propostas: {
        Row: {
          cliente_cnpj: string | null
          cliente_contato: string | null
          cliente_id: number | null
          cliente_nome: string | null
          completude_atualizada_em: string | null
          completude_snapshot: Json
          criado_em: string
          data_solicitacao: string
          descricao: string | null
          escopo_preliminar: string | null
          id: number
          instituicao: string | null
          matriz_amostra: string | null
          modalidade: string
          param_impostos: number | null
          param_incubacao: number | null
          param_investimentos: number | null
          param_lucro: number | null
          param_reserva: number | null
          observacoes: string | null
          origem: string | null
          prazo_esperado: string | null
          prazo_tecnico_dias: number | null
          prioridade: string
          projeto_id: number | null
          quantidade_amostras_estimada: number | null
          responsavel_interno: string | null
          status: string
          titulo: string
        }
        Insert: {
          cliente_cnpj?: string | null
          cliente_contato?: string | null
          cliente_id?: number | null
          cliente_nome?: string | null
          completude_atualizada_em?: string | null
          completude_snapshot?: Json
          criado_em?: string
          data_solicitacao?: string
          descricao?: string | null
          escopo_preliminar?: string | null
          id?: never
          instituicao?: string | null
          matriz_amostra?: string | null
          modalidade?: string
          param_impostos?: number | null
          param_incubacao?: number | null
          param_investimentos?: number | null
          param_lucro?: number | null
          param_reserva?: number | null
          observacoes?: string | null
          origem?: string | null
          prazo_esperado?: string | null
          prazo_tecnico_dias?: number | null
          prioridade?: string
          projeto_id?: number | null
          quantidade_amostras_estimada?: number | null
          responsavel_interno?: string | null
          status?: string
          titulo: string
        }
        Update: {
          cliente_cnpj?: string | null
          cliente_contato?: string | null
          cliente_id?: number | null
          cliente_nome?: string | null
          completude_atualizada_em?: string | null
          completude_snapshot?: Json
          criado_em?: string
          data_solicitacao?: string
          descricao?: string | null
          escopo_preliminar?: string | null
          id?: never
          instituicao?: string | null
          matriz_amostra?: string | null
          modalidade?: string
          param_impostos?: number | null
          param_incubacao?: number | null
          param_investimentos?: number | null
          param_lucro?: number | null
          param_reserva?: number | null
          observacoes?: string | null
          origem?: string | null
          prazo_esperado?: string | null
          prazo_tecnico_dias?: number | null
          prioridade?: string
          projeto_id?: number | null
          quantidade_amostras_estimada?: number | null
          responsavel_interno?: string | null
          status?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "demandas_propostas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demandas_propostas_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      equipamento_analise: {
        Row: {
          codigo_analise: string
          equipamento_id: number
          id: number
          peso_alocacao: number
        }
        Insert: {
          codigo_analise: string
          equipamento_id: number
          id?: never
          peso_alocacao?: number
        }
        Update: {
          codigo_analise?: string
          equipamento_id?: number
          id?: never
          peso_alocacao?: number
        }
        Relationships: [
          {
            foreignKeyName: "equipamento_analise_codigo_analise_fkey"
            columns: ["codigo_analise"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "equipamento_analise_equipamento_id_fkey"
            columns: ["equipamento_id"]
            isOneToOne: false
            referencedRelation: "equipamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      equipamento_manutencoes: {
        Row: {
          bloqueia_operacao: boolean
          created_by: string | null
          criado_em: string
          custo: number
          data_conclusao: string | null
          data_inicio: string | null
          data_programada: string
          descricao: string | null
          documento_laudo_url: string | null
          equipamento_unidade_id: number
          fornecedor_id: number | null
          id: number
          numero_documento: string | null
          ordem_servico: string | null
          proxima_data: string | null
          resultado: string | null
          status: string
          tecnico_responsavel: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          bloqueia_operacao?: boolean
          created_by?: string | null
          criado_em?: string
          custo?: number
          data_conclusao?: string | null
          data_inicio?: string | null
          data_programada: string
          descricao?: string | null
          documento_laudo_url?: string | null
          equipamento_unidade_id: number
          fornecedor_id?: number | null
          id?: never
          numero_documento?: string | null
          ordem_servico?: string | null
          proxima_data?: string | null
          resultado?: string | null
          status?: string
          tecnico_responsavel?: string | null
          tipo: string
          updated_at?: string
        }
        Update: {
          bloqueia_operacao?: boolean
          created_by?: string | null
          criado_em?: string
          custo?: number
          data_conclusao?: string | null
          data_inicio?: string | null
          data_programada?: string
          descricao?: string | null
          documento_laudo_url?: string | null
          equipamento_unidade_id?: number
          fornecedor_id?: number | null
          id?: never
          numero_documento?: string | null
          ordem_servico?: string | null
          proxima_data?: string | null
          resultado?: string | null
          status?: string
          tecnico_responsavel?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipamento_manutencoes_equipamento_unidade_id_fkey"
            columns: ["equipamento_unidade_id"]
            isOneToOne: false
            referencedRelation: "equipamento_unidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipamento_manutencoes_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      equipamento_planos_manutencao: {
        Row: {
          ativo: boolean
          criado_em: string
          descricao: string | null
          equipamento_id: number | null
          equipamento_unidade_id: number | null
          id: number
          obrigatorio: boolean
          periodicidade_dias: number
          tipo: string
          tolerancia_dias: number
        }
        Insert: {
          ativo?: boolean
          criado_em?: string
          descricao?: string | null
          equipamento_id?: number | null
          equipamento_unidade_id?: number | null
          id?: never
          obrigatorio?: boolean
          periodicidade_dias: number
          tipo: string
          tolerancia_dias?: number
        }
        Update: {
          ativo?: boolean
          criado_em?: string
          descricao?: string | null
          equipamento_id?: number | null
          equipamento_unidade_id?: number | null
          id?: never
          obrigatorio?: boolean
          periodicidade_dias?: number
          tipo?: string
          tolerancia_dias?: number
        }
        Relationships: [
          {
            foreignKeyName: "equipamento_planos_manutencao_equipamento_id_fkey"
            columns: ["equipamento_id"]
            isOneToOne: false
            referencedRelation: "equipamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipamento_planos_manutencao_equipamento_unidade_id_fkey"
            columns: ["equipamento_unidade_id"]
            isOneToOne: false
            referencedRelation: "equipamento_unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      equipamento_reservas: {
        Row: {
          criado_em: string
          criado_por: string | null
          data_fim: string
          data_inicio: string
          equipamento_unidade_id: number
          id: number
          liberado_em: string | null
          local_id: number | null
          observacao: string | null
          planejamento_id: number | null
          projeto_id: number | null
          responsavel: string | null
          status: string
        }
        Insert: {
          criado_em?: string
          criado_por?: string | null
          data_fim: string
          data_inicio: string
          equipamento_unidade_id: number
          id?: never
          liberado_em?: string | null
          local_id?: number | null
          observacao?: string | null
          planejamento_id?: number | null
          projeto_id?: number | null
          responsavel?: string | null
          status?: string
        }
        Update: {
          criado_em?: string
          criado_por?: string | null
          data_fim?: string
          data_inicio?: string
          equipamento_unidade_id?: number
          id?: never
          liberado_em?: string | null
          local_id?: number | null
          observacao?: string | null
          planejamento_id?: number | null
          projeto_id?: number | null
          responsavel?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipamento_reservas_equipamento_unidade_id_fkey"
            columns: ["equipamento_unidade_id"]
            isOneToOne: false
            referencedRelation: "equipamento_unidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipamento_reservas_local_id_fkey"
            columns: ["local_id"]
            isOneToOne: false
            referencedRelation: "locais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipamento_reservas_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "planejamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipamento_reservas_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "v_margem_real_planejamento"
            referencedColumns: ["planejamento_id"]
          },
          {
            foreignKeyName: "equipamento_reservas_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "v_planejamento_compromissos_estoque"
            referencedColumns: ["planejamento_id"]
          },
          {
            foreignKeyName: "equipamento_reservas_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      equipamento_status_log: {
        Row: {
          criado_em: string
          equipamento_unidade_id: number
          id: number
          motivo: string | null
          status_anterior: string | null
          status_novo: string
          usuario_id: string | null
        }
        Insert: {
          criado_em?: string
          equipamento_unidade_id: number
          id?: never
          motivo?: string | null
          status_anterior?: string | null
          status_novo: string
          usuario_id?: string | null
        }
        Update: {
          criado_em?: string
          equipamento_unidade_id?: number
          id?: never
          motivo?: string | null
          status_anterior?: string | null
          status_novo?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipamento_status_log_equipamento_unidade_id_fkey"
            columns: ["equipamento_unidade_id"]
            isOneToOne: false
            referencedRelation: "equipamento_unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      equipamento_unidades: {
        Row: {
          ativo: boolean
          codigo_patrimonio: string | null
          criado_em: string
          custo_aquisicao: number | null
          data_aquisicao: string | null
          data_prevista_substituicao: string | null
          equipamento_id: number
          fabricante: string | null
          id: number
          local_id: number | null
          modelo: string | null
          numero_serie: string | null
          observacoes: string | null
          status_operacional: string
          updated_at: string
          vida_util_anos: number | null
        }
        Insert: {
          ativo?: boolean
          codigo_patrimonio?: string | null
          criado_em?: string
          custo_aquisicao?: number | null
          data_aquisicao?: string | null
          data_prevista_substituicao?: string | null
          equipamento_id: number
          fabricante?: string | null
          id?: never
          local_id?: number | null
          modelo?: string | null
          numero_serie?: string | null
          observacoes?: string | null
          status_operacional?: string
          updated_at?: string
          vida_util_anos?: number | null
        }
        Update: {
          ativo?: boolean
          codigo_patrimonio?: string | null
          criado_em?: string
          custo_aquisicao?: number | null
          data_aquisicao?: string | null
          data_prevista_substituicao?: string | null
          equipamento_id?: number
          fabricante?: string | null
          id?: never
          local_id?: number | null
          modelo?: string | null
          numero_serie?: string | null
          observacoes?: string | null
          status_operacional?: string
          updated_at?: string
          vida_util_anos?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "equipamento_unidades_equipamento_id_fkey"
            columns: ["equipamento_id"]
            isOneToOne: false
            referencedRelation: "equipamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipamento_unidades_local_id_fkey"
            columns: ["local_id"]
            isOneToOne: false
            referencedRelation: "locais"
            referencedColumns: ["id"]
          },
        ]
      }
      equipamentos: {
        Row: {
          custo_unitario: number
          data_aquisicao: string | null
          data_validade: string | null
          id: number
          manutencao_anual_fixa: number | null
          nome: string
          percentual_manutencao_anual: number
          possui: boolean
          quantidade: number
          vida_util_anos: number | null
        }
        Insert: {
          custo_unitario?: number
          data_aquisicao?: string | null
          data_validade?: string | null
          id?: never
          manutencao_anual_fixa?: number | null
          nome: string
          percentual_manutencao_anual?: number
          possui?: boolean
          quantidade?: number
          vida_util_anos?: number | null
        }
        Update: {
          custo_unitario?: number
          data_aquisicao?: string | null
          data_validade?: string | null
          id?: never
          manutencao_anual_fixa?: number | null
          nome?: string
          percentual_manutencao_anual?: number
          possui?: boolean
          quantidade?: number
          vida_util_anos?: number | null
        }
        Relationships: []
      }
      estoque_movimentacoes: {
        Row: {
          criado_em: string
          custo_unitario: number | null
          data: string
          id: number
          insumo_id: number
          lote_id: number | null
          motivo: string | null
          quantidade: number
          referencia: string | null
          tipo: string
          usuario: string | null
        }
        Insert: {
          criado_em?: string
          custo_unitario?: number | null
          data?: string
          id?: never
          insumo_id: number
          lote_id?: number | null
          motivo?: string | null
          quantidade: number
          referencia?: string | null
          tipo: string
          usuario?: string | null
        }
        Update: {
          criado_em?: string
          custo_unitario?: number | null
          data?: string
          id?: never
          insumo_id?: number
          lote_id?: number | null
          motivo?: string | null
          quantidade?: number
          referencia?: string | null
          tipo?: string
          usuario?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_movimentacoes_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_custo_estoque_vigente"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_estoque_saldo"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_previsao_suprimentos"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_estoque"
            referencedColumns: ["id"]
          },
        ]
      }
      etapas: {
        Row: {
          amostras_por_execucao: number | null
          atividade_opcional: boolean
          codigo_analise: string
          dia_fim_max: number | null
          dia_inicio: string | null
          escopo_operacional: string
          execucoes_por_dia: number | null
          id: number
          nome_atividade: string
          nome_etapa: string
          ordem: number | null
          tempo_bancada_h: number | null
          tempo_maquina_h: number | null
          tipo_limitacao: string | null
        }
        Insert: {
          amostras_por_execucao?: number | null
          atividade_opcional?: boolean
          codigo_analise: string
          dia_fim_max?: number | null
          dia_inicio?: string | null
          escopo_operacional?: string
          execucoes_por_dia?: number | null
          id?: never
          nome_atividade: string
          nome_etapa: string
          ordem?: number | null
          tempo_bancada_h?: number | null
          tempo_maquina_h?: number | null
          tipo_limitacao?: string | null
        }
        Update: {
          amostras_por_execucao?: number | null
          atividade_opcional?: boolean
          codigo_analise?: string
          dia_fim_max?: number | null
          dia_inicio?: string | null
          escopo_operacional?: string
          execucoes_por_dia?: number | null
          id?: never
          nome_atividade?: string
          nome_etapa?: string
          ordem?: number | null
          tempo_bancada_h?: number | null
          tempo_maquina_h?: number | null
          tipo_limitacao?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "etapas_codigo_analise_fkey"
            columns: ["codigo_analise"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["codigo"]
          },
        ]
      }
      eventos_status: {
        Row: {
          criado_em: string
          de_status: string | null
          entidade: string
          entidade_id: number
          id: number
          observacao: string | null
          operacao_id: string | null
          operacao_payload: Json | null
          para_status: string
          usuario: string | null
        }
        Insert: {
          criado_em?: string
          de_status?: string | null
          entidade: string
          entidade_id: number
          id?: never
          observacao?: string | null
          operacao_id?: string | null
          operacao_payload?: Json | null
          para_status: string
          usuario?: string | null
        }
        Update: {
          criado_em?: string
          de_status?: string | null
          entidade?: string
          entidade_id?: number
          id?: never
          observacao?: string | null
          operacao_id?: string | null
          operacao_payload?: Json | null
          para_status?: string
          usuario?: string | null
        }
        Relationships: []
      }
      fornecedores: {
        Row: {
          ativo: boolean
          catalogo_padrao: string | null
          cnpj: string | null
          contato: string | null
          email: string | null
          endereco: string | null
          id: number
          nome: string
          observacoes: string | null
          prazo_max_dias: number | null
          prazo_medio_dias: number | null
          site: string | null
          telefone: string | null
        }
        Insert: {
          ativo?: boolean
          catalogo_padrao?: string | null
          cnpj?: string | null
          contato?: string | null
          email?: string | null
          endereco?: string | null
          id?: never
          nome: string
          observacoes?: string | null
          prazo_max_dias?: number | null
          prazo_medio_dias?: number | null
          site?: string | null
          telefone?: string | null
        }
        Update: {
          ativo?: boolean
          catalogo_padrao?: string | null
          cnpj?: string | null
          contato?: string | null
          email?: string | null
          endereco?: string | null
          id?: never
          nome?: string
          observacoes?: string | null
          prazo_max_dias?: number | null
          prazo_medio_dias?: number | null
          site?: string | null
          telefone?: string | null
        }
        Relationships: []
      }
      identificadores: {
        Row: {
          ativo: boolean
          atualizado_em: string
          codigo: string
          codigo_normalizado: string
          criado_em: string
          criado_por: string | null
          entidade_id: number
          entidade_tipo: string
          formato: string | null
          id: number
          metadata: Json
          origem: string
          principal: boolean
          tipo: string
          valor: string
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          codigo: string
          codigo_normalizado: string
          criado_em?: string
          criado_por?: string | null
          entidade_id: number
          entidade_tipo: string
          formato?: string | null
          id?: number
          metadata?: Json
          origem?: string
          principal?: boolean
          tipo: string
          valor: string
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          codigo?: string
          codigo_normalizado?: string
          criado_em?: string
          criado_por?: string | null
          entidade_id?: number
          entidade_tipo?: string
          formato?: string | null
          id?: number
          metadata?: Json
          origem?: string
          principal?: boolean
          tipo?: string
          valor?: string
        }
        Relationships: []
      }
      insumo_analise: {
        Row: {
          base_calculo: string | null
          codigo_analise: string
          especificacao_insumo: string | null
          etapa_id: number | null
          grupo_escolha: string | null
          id: number
          insumo_id: number | null
          modo_cobranca: string | null
          nome_atividade: string
          nome_etapa: string
          preferencial: boolean
          quantidade_por_amostra: number | null
          unidade: string | null
        }
        Insert: {
          base_calculo?: string | null
          codigo_analise: string
          especificacao_insumo?: string | null
          etapa_id?: number | null
          grupo_escolha?: string | null
          id?: never
          insumo_id?: number | null
          modo_cobranca?: string | null
          nome_atividade: string
          nome_etapa: string
          preferencial?: boolean
          quantidade_por_amostra?: number | null
          unidade?: string | null
        }
        Update: {
          base_calculo?: string | null
          codigo_analise?: string
          especificacao_insumo?: string | null
          etapa_id?: number | null
          grupo_escolha?: string | null
          id?: never
          insumo_id?: number | null
          modo_cobranca?: string | null
          nome_atividade?: string
          nome_etapa?: string
          preferencial?: boolean
          quantidade_por_amostra?: number | null
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insumo_analise_codigo_analise_fkey"
            columns: ["codigo_analise"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "insumo_analise_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "etapas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insumo_analise_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insumo_analise_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_custo_estoque_vigente"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "insumo_analise_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_estoque_saldo"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "insumo_analise_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_previsao_suprimentos"
            referencedColumns: ["insumo_id"]
          },
        ]
      }
      insumos: {
        Row: {
          categoria_compra: string | null
          codigo_fabricante: string | null
          codigo_interno: string | null
          condicao_armazenamento: string | null
          custo_total_embalagem: number | null
          custo_unitario: number | null
          data_aquisicao: string | null
          data_fabricacao: string | null
          data_validade: string | null
          especificacao: string
          estoque_seguranca: number
          fabricante: string | null
          fator_conversao: number
          fornecedor_alt_id: number | null
          fornecedor_id: number | null
          id: number
          lead_time_dias: number | null
          nome_item: string | null
          ponto_reposicao: number
          prazo_entrega_max_dias: number | null
          quantidade_embalagem: number | null
          quantidade_minima_compra: number | null
          sds_url: string | null
          tipo_insumo_id: number | null
          unidade: string | null
          unidade_consumo: string | null
          validade_apos_abertura_dias: number | null
          validade_dias: number | null
        }
        Insert: {
          categoria_compra?: string | null
          codigo_fabricante?: string | null
          codigo_interno?: string | null
          condicao_armazenamento?: string | null
          custo_total_embalagem?: number | null
          custo_unitario?: number | null
          data_aquisicao?: string | null
          data_fabricacao?: string | null
          data_validade?: string | null
          especificacao: string
          estoque_seguranca?: number
          fabricante?: string | null
          fator_conversao?: number
          fornecedor_alt_id?: number | null
          fornecedor_id?: number | null
          id?: never
          lead_time_dias?: number | null
          nome_item?: string | null
          ponto_reposicao?: number
          prazo_entrega_max_dias?: number | null
          quantidade_embalagem?: number | null
          quantidade_minima_compra?: number | null
          sds_url?: string | null
          tipo_insumo_id?: number | null
          unidade?: string | null
          unidade_consumo?: string | null
          validade_apos_abertura_dias?: number | null
          validade_dias?: number | null
        }
        Update: {
          categoria_compra?: string | null
          codigo_fabricante?: string | null
          codigo_interno?: string | null
          condicao_armazenamento?: string | null
          custo_total_embalagem?: number | null
          custo_unitario?: number | null
          data_aquisicao?: string | null
          data_fabricacao?: string | null
          data_validade?: string | null
          especificacao?: string
          estoque_seguranca?: number
          fabricante?: string | null
          fator_conversao?: number
          fornecedor_alt_id?: number | null
          fornecedor_id?: number | null
          id?: never
          lead_time_dias?: number | null
          nome_item?: string | null
          ponto_reposicao?: number
          prazo_entrega_max_dias?: number | null
          quantidade_embalagem?: number | null
          quantidade_minima_compra?: number | null
          sds_url?: string | null
          tipo_insumo_id?: number | null
          unidade?: string | null
          unidade_consumo?: string | null
          validade_apos_abertura_dias?: number | null
          validade_dias?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "insumos_fornecedor_alt_id_fkey"
            columns: ["fornecedor_alt_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insumos_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insumos_tipo_insumo_id_fkey"
            columns: ["tipo_insumo_id"]
            isOneToOne: false
            referencedRelation: "tipo_insumos"
            referencedColumns: ["id"]
          },
        ]
      }
      inventario_ciclos: {
        Row: {
          criado_em: string
          criado_por: string | null
          fechado_em: string | null
          id: number
          local_id: number | null
          nome: string | null
          status: string
        }
        Insert: {
          criado_em?: string
          criado_por?: string | null
          fechado_em?: string | null
          id?: never
          local_id?: number | null
          nome?: string | null
          status?: string
        }
        Update: {
          criado_em?: string
          criado_por?: string | null
          fechado_em?: string | null
          id?: never
          local_id?: number | null
          nome?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventario_ciclos_local_id_fkey"
            columns: ["local_id"]
            isOneToOne: false
            referencedRelation: "locais"
            referencedColumns: ["id"]
          },
        ]
      }
      inventario_contagens: {
        Row: {
          ajustado_em: string | null
          ajustado_por: string | null
          ajuste_aplicado: boolean
          ciclo_id: number
          contado_em: string
          contado_por: string | null
          divergencia: number
          id: number
          justificativa: string | null
          local_id: number | null
          lote_id: number
          quantidade_contada: number
          quantidade_sistema: number
        }
        Insert: {
          ajustado_em?: string | null
          ajustado_por?: string | null
          ajuste_aplicado?: boolean
          ciclo_id: number
          contado_em?: string
          contado_por?: string | null
          divergencia?: number
          id?: never
          justificativa?: string | null
          local_id?: number | null
          lote_id: number
          quantidade_contada: number
          quantidade_sistema: number
        }
        Update: {
          ajustado_em?: string | null
          ajustado_por?: string | null
          ajuste_aplicado?: boolean
          ciclo_id?: number
          contado_em?: string
          contado_por?: string | null
          divergencia?: number
          id?: never
          justificativa?: string | null
          local_id?: number | null
          lote_id?: number
          quantidade_contada?: number
          quantidade_sistema?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventario_contagens_ciclo_id_fkey"
            columns: ["ciclo_id"]
            isOneToOne: false
            referencedRelation: "inventario_ciclos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventario_contagens_local_id_fkey"
            columns: ["local_id"]
            isOneToOne: false
            referencedRelation: "locais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventario_contagens_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_estoque"
            referencedColumns: ["id"]
          },
        ]
      }
      locais: {
        Row: {
          condicao_armazenamento: string | null
          id: number
          nome: string
          parent_id: number | null
          tipo: string | null
        }
        Insert: {
          condicao_armazenamento?: string | null
          id?: never
          nome: string
          parent_id?: number | null
          tipo?: string | null
        }
        Update: {
          condicao_armazenamento?: string | null
          id?: never
          nome?: string
          parent_id?: number | null
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locais_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "locais"
            referencedColumns: ["id"]
          },
        ]
      }
      lotes_estoque: {
        Row: {
          certificado_analise: string | null
          codigo_lote: string | null
          condicao_recebimento: string | null
          criado_em: string
          criterio_aceitacao: string | null
          custo_unitario: number | null
          data_abertura: string | null
          data_entrada: string
          fornecedor: string | null
          id: number
          insumo_id: number
          local_id: number | null
          motivo_bloqueio: string | null
          nota_fiscal: string | null
          projeto: string | null
          quantidade_atual: number
          quantidade_inicial: number
          responsavel_liberacao: string | null
          responsavel_recebimento: string | null
          status: string
          validade: string | null
          validade_apos_abertura: string | null
        }
        Insert: {
          certificado_analise?: string | null
          codigo_lote?: string | null
          condicao_recebimento?: string | null
          criado_em?: string
          criterio_aceitacao?: string | null
          custo_unitario?: number | null
          data_abertura?: string | null
          data_entrada?: string
          fornecedor?: string | null
          id?: never
          insumo_id: number
          local_id?: number | null
          motivo_bloqueio?: string | null
          nota_fiscal?: string | null
          projeto?: string | null
          quantidade_atual: number
          quantidade_inicial: number
          responsavel_liberacao?: string | null
          responsavel_recebimento?: string | null
          status?: string
          validade?: string | null
          validade_apos_abertura?: string | null
        }
        Update: {
          certificado_analise?: string | null
          codigo_lote?: string | null
          condicao_recebimento?: string | null
          criado_em?: string
          criterio_aceitacao?: string | null
          custo_unitario?: number | null
          data_abertura?: string | null
          data_entrada?: string
          fornecedor?: string | null
          id?: never
          insumo_id?: number
          local_id?: number | null
          motivo_bloqueio?: string | null
          nota_fiscal?: string | null
          projeto?: string | null
          quantidade_atual?: number
          quantidade_inicial?: number
          responsavel_liberacao?: string | null
          responsavel_recebimento?: string | null
          status?: string
          validade?: string | null
          validade_apos_abertura?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lotes_estoque_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lotes_estoque_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_custo_estoque_vigente"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "lotes_estoque_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_estoque_saldo"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "lotes_estoque_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_previsao_suprimentos"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "lotes_estoque_local_id_fkey"
            columns: ["local_id"]
            isOneToOne: false
            referencedRelation: "locais"
            referencedColumns: ["id"]
          },
        ]
      }
      matrizes_amostras: {
        Row: {
          ativo: boolean
          codigo: string
          criado_em: string
          descricao: string | null
          id: number
          nome: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          criado_em?: string
          descricao?: string | null
          id?: number
          nome: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          criado_em?: string
          descricao?: string | null
          id?: number
          nome?: string
        }
        Relationships: []
      }
      notificacoes: {
        Row: {
          canal: string
          corpo: string | null
          criado_em: string
          dedupe_key: string | null
          email_enviado_em: string | null
          email_erro: string | null
          email_tentativas: number
          entidade_id: number | null
          entidade_tipo: string | null
          id: number
          lida_em: string | null
          papel_destino: string | null
          permissao_destino: string | null
          status: string
          tipo: string
          titulo: string
          usuario_destino: string | null
        }
        Insert: {
          canal?: string
          corpo?: string | null
          criado_em?: string
          dedupe_key?: string | null
          email_enviado_em?: string | null
          email_erro?: string | null
          email_tentativas?: number
          entidade_id?: number | null
          entidade_tipo?: string | null
          id?: never
          lida_em?: string | null
          papel_destino?: string | null
          permissao_destino?: string | null
          status?: string
          tipo: string
          titulo: string
          usuario_destino?: string | null
        }
        Update: {
          canal?: string
          corpo?: string | null
          criado_em?: string
          dedupe_key?: string | null
          email_enviado_em?: string | null
          email_erro?: string | null
          email_tentativas?: number
          entidade_id?: number | null
          entidade_tipo?: string | null
          id?: never
          lida_em?: string | null
          papel_destino?: string | null
          permissao_destino?: string | null
          status?: string
          tipo?: string
          titulo?: string
          usuario_destino?: string | null
        }
        Relationships: []
      }
      notificacoes_leituras: {
        Row: {
          arquivada_em: string | null
          lida_em: string | null
          notificacao_id: number
          user_id: string
        }
        Insert: {
          arquivada_em?: string | null
          lida_em?: string | null
          notificacao_id: number
          user_id?: string
        }
        Update: {
          arquivada_em?: string | null
          lida_em?: string | null
          notificacao_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_leituras_notificacao_id_fkey"
            columns: ["notificacao_id"]
            isOneToOne: false
            referencedRelation: "notificacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_final_versoes: {
        Row: {
          cancelado_em: string | null
          cancelado_motivo: string | null
          classificacao_motivo: string | null
          classificado_em: string | null
          classificado_por: string | null
          criado_em: string
          criado_por: string | null
          demanda_id: number
          duplicada_de_id: number | null
          id: number
          numero: string
          operacao_id: string | null
          operacao_payload: Json | null
          snapshot: Json
          status: string
          total_final: number
          total_laboratorio_custo: number
          total_laboratorio_preco: number
          total_projeto_custo: number
          total_projeto_final: number
          validade_dias: number
          valido_ate: string | null
          versao: number
        }
        Insert: {
          cancelado_em?: string | null
          cancelado_motivo?: string | null
          classificacao_motivo?: string | null
          classificado_em?: string | null
          classificado_por?: string | null
          criado_em?: string
          criado_por?: string | null
          demanda_id: number
          duplicada_de_id?: number | null
          id?: never
          numero: string
          operacao_id?: string | null
          operacao_payload?: Json | null
          snapshot?: Json
          status?: string
          total_final?: number
          total_laboratorio_custo?: number
          total_laboratorio_preco?: number
          total_projeto_custo?: number
          total_projeto_final?: number
          validade_dias?: number
          valido_ate?: string | null
          versao: number
        }
        Update: {
          cancelado_em?: string | null
          cancelado_motivo?: string | null
          classificacao_motivo?: string | null
          classificado_em?: string | null
          classificado_por?: string | null
          criado_em?: string
          criado_por?: string | null
          demanda_id?: number
          duplicada_de_id?: number | null
          id?: never
          numero?: string
          operacao_id?: string | null
          operacao_payload?: Json | null
          snapshot?: Json
          status?: string
          total_final?: number
          total_laboratorio_custo?: number
          total_laboratorio_preco?: number
          total_projeto_custo?: number
          total_projeto_final?: number
          validade_dias?: number
          valido_ate?: string | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_final_versoes_demanda_id_fkey"
            columns: ["demanda_id"]
            isOneToOne: false
            referencedRelation: "demandas_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_final_versoes_duplicada_de_id_fkey"
            columns: ["duplicada_de_id"]
            isOneToOne: false
            referencedRelation: "orcamento_final_versoes"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_fundos_acompanhamento: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          id: number
          impostos_pagos: number
          incubacao_paga: number
          investimento_gasto: number
          investimento_saldo_ajustado: number | null
          observacao: string | null
          orcamento_final_versao_id: number
          reserva_gasta: number
          reserva_saldo_ajustado: number | null
          saldo_ajustado_motivo: string | null
          valor_recebido: number
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          id?: never
          impostos_pagos?: number
          incubacao_paga?: number
          investimento_gasto?: number
          investimento_saldo_ajustado?: number | null
          observacao?: string | null
          orcamento_final_versao_id: number
          reserva_gasta?: number
          reserva_saldo_ajustado?: number | null
          saldo_ajustado_motivo?: string | null
          valor_recebido?: number
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          id?: never
          impostos_pagos?: number
          incubacao_paga?: number
          investimento_gasto?: number
          investimento_saldo_ajustado?: number | null
          observacao?: string | null
          orcamento_final_versao_id?: number
          reserva_gasta?: number
          reserva_saldo_ajustado?: number | null
          saldo_ajustado_motivo?: string | null
          valor_recebido?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_fundos_acompanhamento_orcamento_final_versao_id_fkey"
            columns: ["orcamento_final_versao_id"]
            isOneToOne: true
            referencedRelation: "orcamento_final_versoes"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_itens: {
        Row: {
          codigo_analise: string
          custo_unitario: number
          id: number
          n_amostras: number
          orcamento_id: number
          preco_unitario: number
          valor_snapshot: Json
        }
        Insert: {
          codigo_analise: string
          custo_unitario?: number
          id?: never
          n_amostras?: number
          orcamento_id: number
          preco_unitario?: number
          valor_snapshot?: Json
        }
        Update: {
          codigo_analise?: string
          custo_unitario?: number
          id?: never
          n_amostras?: number
          orcamento_id?: number
          preco_unitario?: number
          valor_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_itens_codigo_analise_fkey"
            columns: ["codigo_analise"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_parametros_aplicados: {
        Row: {
          alertas_snapshot: Json
          criado_em: string
          criado_por: string | null
          demanda_id: number | null
          formula_snapshot: Json
          id: number
          laboratorio_modo: string
          metodo_calculo: string
          orcamento_final_versao_id: number | null
          orcamento_laboratorial_id: number | null
          orcamento_projeto_id: number | null
          origem: string
          parametros_snapshot: Json
          subtotal_custos: number
          subtotal_laboratorio: number
          subtotal_projeto: number
          total_final: number
          total_parametros: number
          versao: number
        }
        Insert: {
          alertas_snapshot?: Json
          criado_em?: string
          criado_por?: string | null
          demanda_id?: number | null
          formula_snapshot?: Json
          id?: never
          laboratorio_modo?: string
          metodo_calculo: string
          orcamento_final_versao_id?: number | null
          orcamento_laboratorial_id?: number | null
          orcamento_projeto_id?: number | null
          origem?: string
          parametros_snapshot?: Json
          subtotal_custos?: number
          subtotal_laboratorio?: number
          subtotal_projeto?: number
          total_final?: number
          total_parametros?: number
          versao?: number
        }
        Update: {
          alertas_snapshot?: Json
          criado_em?: string
          criado_por?: string | null
          demanda_id?: number | null
          formula_snapshot?: Json
          id?: never
          laboratorio_modo?: string
          metodo_calculo?: string
          orcamento_final_versao_id?: number | null
          orcamento_laboratorial_id?: number | null
          orcamento_projeto_id?: number | null
          origem?: string
          parametros_snapshot?: Json
          subtotal_custos?: number
          subtotal_laboratorio?: number
          subtotal_projeto?: number
          total_final?: number
          total_parametros?: number
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_parametros_aplicados_demanda_id_fkey"
            columns: ["demanda_id"]
            isOneToOne: false
            referencedRelation: "demandas_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_parametros_aplicados_orcamento_final_versao_id_fkey"
            columns: ["orcamento_final_versao_id"]
            isOneToOne: false
            referencedRelation: "orcamento_final_versoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_parametros_aplicados_orcamento_laboratorial_id_fkey"
            columns: ["orcamento_laboratorial_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_parametros_aplicados_orcamento_projeto_id_fkey"
            columns: ["orcamento_projeto_id"]
            isOneToOne: false
            referencedRelation: "orcamento_projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_projeto_analises: {
        Row: {
          codigo_analise: string
          custo_unitario: number
          id: number
          n_amostras: number
          orcamento_projeto_id: number
          preco_unitario: number
          valor_snapshot: Json
        }
        Insert: {
          codigo_analise: string
          custo_unitario?: number
          id?: never
          n_amostras?: number
          orcamento_projeto_id: number
          preco_unitario?: number
          valor_snapshot?: Json
        }
        Update: {
          codigo_analise?: string
          custo_unitario?: number
          id?: never
          n_amostras?: number
          orcamento_projeto_id?: number
          preco_unitario?: number
          valor_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_projeto_analises_codigo_analise_fkey"
            columns: ["codigo_analise"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "orcamento_projeto_analises_orcamento_projeto_id_fkey"
            columns: ["orcamento_projeto_id"]
            isOneToOne: false
            referencedRelation: "orcamento_projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_projeto_anexos: {
        Row: {
          content_type: string | null
          criado_em: string
          criado_por: string | null
          id: number
          nome_arquivo: string
          orcamento_projeto_id: number
          path: string
          tamanho: number | null
        }
        Insert: {
          content_type?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: never
          nome_arquivo: string
          orcamento_projeto_id: number
          path: string
          tamanho?: number | null
        }
        Update: {
          content_type?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: never
          nome_arquivo?: string
          orcamento_projeto_id?: number
          path?: string
          tamanho?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_projeto_anexos_orcamento_projeto_id_fkey"
            columns: ["orcamento_projeto_id"]
            isOneToOne: false
            referencedRelation: "orcamento_projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_projeto_catalogo: {
        Row: {
          ativo: boolean
          atualizado_em: string
          categoria: string | null
          criado_em: string
          descricao: string
          id: string
          origem: string
          preco_unitario: number
          rubrica: string
          unidade: string | null
          valid_from: string | null
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          categoria?: string | null
          criado_em?: string
          descricao: string
          id: string
          origem?: string
          preco_unitario?: number
          rubrica: string
          unidade?: string | null
          valid_from?: string | null
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          categoria?: string | null
          criado_em?: string
          descricao?: string
          id?: string
          origem?: string
          preco_unitario?: number
          rubrica?: string
          unidade?: string | null
          valid_from?: string | null
        }
        Relationships: []
      }
      orcamento_projeto_custos: {
        Row: {
          atividade: string | null
          catalogo_item_id: string | null
          categoria: string
          categoria_institucional: string | null
          custo_unitario: number
          descricao: string
          entrega: string | null
          etapa: string | null
          id: number
          meses_selecionados: number[]
          nomenclatura_origem: string
          orcamento_projeto_id: number
          origem: string
          preco_unitario: number
          quantidade: number
          rubrica: string | null
          unidade: string | null
          valor_snapshot: Json
        }
        Insert: {
          atividade?: string | null
          catalogo_item_id?: string | null
          categoria: string
          categoria_institucional?: string | null
          custo_unitario?: number
          descricao: string
          entrega?: string | null
          etapa?: string | null
          id?: never
          meses_selecionados?: number[]
          nomenclatura_origem?: string
          orcamento_projeto_id: number
          origem?: string
          preco_unitario?: number
          quantidade?: number
          rubrica?: string | null
          unidade?: string | null
          valor_snapshot?: Json
        }
        Update: {
          atividade?: string | null
          catalogo_item_id?: string | null
          categoria?: string
          categoria_institucional?: string | null
          custo_unitario?: number
          descricao?: string
          entrega?: string | null
          etapa?: string | null
          id?: never
          meses_selecionados?: number[]
          nomenclatura_origem?: string
          orcamento_projeto_id?: number
          origem?: string
          preco_unitario?: number
          quantidade?: number
          rubrica?: string | null
          unidade?: string | null
          valor_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_projeto_custos_catalogo_item_id_fkey"
            columns: ["catalogo_item_id"]
            isOneToOne: false
            referencedRelation: "orcamento_projeto_catalogo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_projeto_custos_orcamento_projeto_id_fkey"
            columns: ["orcamento_projeto_id"]
            isOneToOne: false
            referencedRelation: "orcamento_projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_projeto_links: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          criado_em: string
          criado_por: string | null
          expira_em: string | null
          id: number
          orcamento_final_versao_id: number | null
          orcamento_projeto_id: number | null
          revogado: boolean
          token_hash: string
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          criado_em?: string
          criado_por?: string | null
          expira_em?: string | null
          id?: never
          orcamento_final_versao_id?: number | null
          orcamento_projeto_id?: number | null
          revogado?: boolean
          token_hash: string
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          criado_em?: string
          criado_por?: string | null
          expira_em?: string | null
          id?: never
          orcamento_final_versao_id?: number | null
          orcamento_projeto_id?: number | null
          revogado?: boolean
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_projeto_links_orcamento_final_versao_id_fkey"
            columns: ["orcamento_final_versao_id"]
            isOneToOne: false
            referencedRelation: "orcamento_final_versoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_projeto_links_orcamento_projeto_id_fkey"
            columns: ["orcamento_projeto_id"]
            isOneToOne: false
            referencedRelation: "orcamento_projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_projeto_templates: {
        Row: {
          criado_em: string
          descricao: string | null
          id: number
          itens: Json
          nome: string
          origem: string
          parametros: Json
        }
        Insert: {
          criado_em?: string
          descricao?: string | null
          id?: never
          itens?: Json
          nome: string
          origem?: string
          parametros?: Json
        }
        Update: {
          criado_em?: string
          descricao?: string | null
          id?: never
          itens?: Json
          nome?: string
          origem?: string
          parametros?: Json
        }
        Relationships: []
      }
      orcamento_projetos: {
        Row: {
          cliente_cnpj: string | null
          cliente_contato: string | null
          cliente_detalhes: string | null
          cliente_email: string | null
          cliente_endereco: string | null
          cliente_id: number | null
          cliente_nome: string | null
          cliente_telefone: string | null
          coordenador: string | null
          criado_em: string
          cronograma: string | null
          data_orcamento: string
          demanda_id: number | null
          escopo: string | null
          id: number
          impostos: number
          impostos_legacy: number
          incubacao: number
          investimentos: number
          lucro: number
          margem_lucro: number
          numero: string | null
          observacoes: string | null
          project_months: number
          projeto_id: number | null
          projeto_sem_custo_justificativa: string | null
          proprietario: string | null
          reserva: number
          responsavel: string | null
          status: string
          titulo: string
          travel_inputs: Json
          validade_dias: number
        }
        Insert: {
          cliente_cnpj?: string | null
          cliente_contato?: string | null
          cliente_detalhes?: string | null
          cliente_email?: string | null
          cliente_endereco?: string | null
          cliente_id?: number | null
          cliente_nome?: string | null
          cliente_telefone?: string | null
          coordenador?: string | null
          criado_em?: string
          cronograma?: string | null
          data_orcamento?: string
          demanda_id?: number | null
          escopo?: string | null
          id?: never
          impostos?: number
          impostos_legacy?: number
          incubacao?: number
          investimentos?: number
          lucro?: number
          margem_lucro?: number
          numero?: string | null
          observacoes?: string | null
          project_months?: number
          projeto_id?: number | null
          projeto_sem_custo_justificativa?: string | null
          proprietario?: string | null
          reserva?: number
          responsavel?: string | null
          status?: string
          titulo: string
          travel_inputs?: Json
          validade_dias?: number
        }
        Update: {
          cliente_cnpj?: string | null
          cliente_contato?: string | null
          cliente_detalhes?: string | null
          cliente_email?: string | null
          cliente_endereco?: string | null
          cliente_id?: number | null
          cliente_nome?: string | null
          cliente_telefone?: string | null
          coordenador?: string | null
          criado_em?: string
          cronograma?: string | null
          data_orcamento?: string
          demanda_id?: number | null
          escopo?: string | null
          id?: never
          impostos?: number
          impostos_legacy?: number
          incubacao?: number
          investimentos?: number
          lucro?: number
          margem_lucro?: number
          numero?: string | null
          observacoes?: string | null
          project_months?: number
          projeto_id?: number | null
          projeto_sem_custo_justificativa?: string | null
          proprietario?: string | null
          reserva?: number
          responsavel?: string | null
          status?: string
          titulo?: string
          travel_inputs?: Json
          validade_dias?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_projetos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_projetos_demanda_id_fkey"
            columns: ["demanda_id"]
            isOneToOne: false
            referencedRelation: "demandas_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_projetos_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos: {
        Row: {
          cliente_cnpj: string | null
          cliente_contato: string | null
          cliente_endereco: string | null
          cliente_id: number | null
          cliente_nome: string
          criado_em: string
          custo_recalculado_em: string | null
          custo_recalculado_por: string | null
          custo_recalculo_motivo: string | null
          custo_revisao: number
          custo_snapshot: Json
          data_orcamento: string
          demanda_id: number | null
          fonte_custo_insumos: string
          id: number
          observacoes: string | null
          projeto_id: number | null
          responsavel: string | null
          status: string
          status_operacional: string
          status_operacional_atualizado_em: string | null
          tipo: string
          validade_dias: number
        }
        Insert: {
          cliente_cnpj?: string | null
          cliente_contato?: string | null
          cliente_endereco?: string | null
          cliente_id?: number | null
          cliente_nome: string
          criado_em?: string
          custo_recalculado_em?: string | null
          custo_recalculado_por?: string | null
          custo_recalculo_motivo?: string | null
          custo_revisao?: number
          custo_snapshot?: Json
          data_orcamento?: string
          demanda_id?: number | null
          fonte_custo_insumos?: string
          id?: never
          observacoes?: string | null
          projeto_id?: number | null
          responsavel?: string | null
          status?: string
          status_operacional?: string
          status_operacional_atualizado_em?: string | null
          tipo?: string
          validade_dias?: number
        }
        Update: {
          cliente_cnpj?: string | null
          cliente_contato?: string | null
          cliente_endereco?: string | null
          cliente_id?: number | null
          cliente_nome?: string
          criado_em?: string
          custo_recalculado_em?: string | null
          custo_recalculado_por?: string | null
          custo_recalculo_motivo?: string | null
          custo_revisao?: number
          custo_snapshot?: Json
          data_orcamento?: string
          demanda_id?: number | null
          fonte_custo_insumos?: string
          id?: never
          observacoes?: string | null
          projeto_id?: number | null
          responsavel?: string | null
          status?: string
          status_operacional?: string
          status_operacional_atualizado_em?: string | null
          tipo?: string
          validade_dias?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_demanda_id_fkey"
            columns: ["demanda_id"]
            isOneToOne: false
            referencedRelation: "demandas_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      overhead: {
        Row: {
          custo_mensal: number
          horas_bancada_mes: number
          id: number
          item: string
          percentual_compensada: number
        }
        Insert: {
          custo_mensal?: number
          horas_bancada_mes?: number
          id?: never
          item: string
          percentual_compensada?: number
        }
        Update: {
          custo_mensal?: number
          horas_bancada_mes?: number
          id?: never
          item?: string
          percentual_compensada?: number
        }
        Relationships: []
      }
      parametros: {
        Row: {
          atualizado_em: string
          chave: string
          descricao: string | null
          unidade: string | null
          valor: number
        }
        Insert: {
          atualizado_em?: string
          chave: string
          descricao?: string | null
          unidade?: string | null
          valor: number
        }
        Update: {
          atualizado_em?: string
          chave?: string
          descricao?: string | null
          unidade?: string | null
          valor?: number
        }
        Relationships: []
      }
      parametros_economicos_versoes: {
        Row: {
          criado_em: string
          criado_por: string | null
          escopo: string
          id: number
          orcamento_projeto_id: number | null
          origem: string
          parametros: Json
          versao: number
        }
        Insert: {
          criado_em?: string
          criado_por?: string | null
          escopo: string
          id?: never
          orcamento_projeto_id?: number | null
          origem?: string
          parametros: Json
          versao: number
        }
        Update: {
          criado_em?: string
          criado_por?: string | null
          escopo?: string
          id?: never
          orcamento_projeto_id?: number | null
          origem?: string
          parametros?: Json
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "parametros_economicos_versoes_orcamento_projeto_id_fkey"
            columns: ["orcamento_projeto_id"]
            isOneToOne: false
            referencedRelation: "orcamento_projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_compra: {
        Row: {
          aprovador: string | null
          criado_em: string
          data_aprovacao: string | null
          data_prevista_entrega: string | null
          data_solicitacao: string
          fornecedor_id: number | null
          id: number
          observacao: string | null
          projeto: string | null
          projeto_id: number | null
          solicitante: string | null
          status: string
        }
        Insert: {
          aprovador?: string | null
          criado_em?: string
          data_aprovacao?: string | null
          data_prevista_entrega?: string | null
          data_solicitacao?: string
          fornecedor_id?: number | null
          id?: never
          observacao?: string | null
          projeto?: string | null
          projeto_id?: number | null
          solicitante?: string | null
          status?: string
        }
        Update: {
          aprovador?: string | null
          criado_em?: string
          data_aprovacao?: string | null
          data_prevista_entrega?: string | null
          data_solicitacao?: string
          fornecedor_id?: number | null
          id?: never
          observacao?: string | null
          projeto?: string | null
          projeto_id?: number | null
          solicitante?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_compra_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_compra_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_compra_item_recebimentos: {
        Row: {
          codigo_lote: string | null
          custo_unitario: number | null
          fornecedor: string | null
          id: number
          insumo_id: number
          lote_id: number
          observacao: string | null
          pedido_compra_id: number
          pedido_compra_item_id: number
          pedido_interno_item_id: number | null
          quantidade: number
          recebido_em: string
          responsavel: string | null
          validade: string | null
        }
        Insert: {
          codigo_lote?: string | null
          custo_unitario?: number | null
          fornecedor?: string | null
          id?: never
          insumo_id: number
          lote_id: number
          observacao?: string | null
          pedido_compra_id: number
          pedido_compra_item_id: number
          pedido_interno_item_id?: number | null
          quantidade: number
          recebido_em?: string
          responsavel?: string | null
          validade?: string | null
        }
        Update: {
          codigo_lote?: string | null
          custo_unitario?: number | null
          fornecedor?: string | null
          id?: never
          insumo_id?: number
          lote_id?: number
          observacao?: string | null
          pedido_compra_id?: number
          pedido_compra_item_id?: number
          pedido_interno_item_id?: number | null
          quantidade?: number
          recebido_em?: string
          responsavel?: string | null
          validade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_compra_item_recebimentos_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_compra_item_recebimentos_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_custo_estoque_vigente"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "pedidos_compra_item_recebimentos_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_estoque_saldo"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "pedidos_compra_item_recebimentos_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_previsao_suprimentos"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "pedidos_compra_item_recebimentos_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: true
            referencedRelation: "lotes_estoque"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_compra_item_recebimentos_pedido_compra_id_fkey"
            columns: ["pedido_compra_id"]
            isOneToOne: false
            referencedRelation: "pedidos_compra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_compra_item_recebimentos_pedido_compra_item_id_fkey"
            columns: ["pedido_compra_item_id"]
            isOneToOne: false
            referencedRelation: "pedidos_compra_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_compra_item_recebimentos_pedido_interno_item_id_fkey"
            columns: ["pedido_interno_item_id"]
            isOneToOne: false
            referencedRelation: "pedidos_internos_itens"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_compra_itens: {
        Row: {
          custo_unitario_estimado: number | null
          divergencia_recebimento: string | null
          id: number
          insumo_id: number
          lote_id: number | null
          pedido_id: number
          pedido_interno_item_id: number | null
          quantidade: number
          quantidade_recebida: number | null
          conteudo_embalagem: number | null
          quantidade_em: string
        }
        Insert: {
          custo_unitario_estimado?: number | null
          divergencia_recebimento?: string | null
          id?: never
          insumo_id: number
          lote_id?: number | null
          pedido_id: number
          pedido_interno_item_id?: number | null
          quantidade: number
          quantidade_recebida?: number | null
          conteudo_embalagem?: number | null
          quantidade_em?: string | null
        }
        Update: {
          custo_unitario_estimado?: number | null
          divergencia_recebimento?: string | null
          id?: never
          insumo_id?: number
          lote_id?: number | null
          pedido_id?: number
          pedido_interno_item_id?: number | null
          quantidade?: number
          quantidade_recebida?: number | null
          conteudo_embalagem?: number | null
          quantidade_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_compra_itens_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_compra_itens_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_custo_estoque_vigente"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "pedidos_compra_itens_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_estoque_saldo"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "pedidos_compra_itens_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_previsao_suprimentos"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "pedidos_compra_itens_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_estoque"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_compra_itens_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_compra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_compra_itens_pedido_interno_item_id_fkey"
            columns: ["pedido_interno_item_id"]
            isOneToOne: false
            referencedRelation: "pedidos_internos_itens"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_internos: {
        Row: {
          analisado_em: string | null
          aprovacao_final_em: string | null
          aprovado_coordenador_em: string | null
          aprovador_coordenador: string | null
          aprovador_coordenador_diferente: boolean
          atualizado_em: string
          comprador_responsavel: string | null
          concluido_em: string | null
          conformidade_admin: string | null
          coordenador_projeto_email: string | null
          coordenador_projeto_nome: string | null
          criado_em: string
          data_envio_instituicao: string | null
          data_necessidade: string | null
          data_retorno_instituicao: string | null
          encaminhado_em: string | null
          enviado_validacao_em: string | null
          fechado_em: string | null
          fonte_recurso: string | null
          formalizado_em: string | null
          id: number
          instituicao_destino: string | null
          justificativa: string | null
          modalidade_compra: string | null
          modalidade_definida_em: string | null
          modalidade_definida_por: string | null
          observacao_administrativa: string | null
          observacao_compras: string | null
          origem: string
          orcamento_previo_total: number | null
          orcamentos_em: string | null
          pagamento_nf_em: string | null
          pedido_compra_id: number | null
          planejamento_id: number | null
          projeto_id: number | null
          protocolo_externo: string | null
          recebido_em: string | null
          recebido_por: string | null
          rubrica: string | null
          solicitante: string | null
          status: string
          tipo_demanda: string
          titulo: string
          urgencia: string
          validado_em: string | null
        }
        Insert: {
          analisado_em?: string | null
          aprovacao_final_em?: string | null
          aprovado_coordenador_em?: string | null
          aprovador_coordenador?: string | null
          aprovador_coordenador_diferente?: boolean
          atualizado_em?: string
          comprador_responsavel?: string | null
          concluido_em?: string | null
          conformidade_admin?: string | null
          coordenador_projeto_email?: string | null
          coordenador_projeto_nome?: string | null
          criado_em?: string
          data_envio_instituicao?: string | null
          data_necessidade?: string | null
          data_retorno_instituicao?: string | null
          encaminhado_em?: string | null
          enviado_validacao_em?: string | null
          fechado_em?: string | null
          fonte_recurso?: string | null
          formalizado_em?: string | null
          id?: never
          instituicao_destino?: string | null
          justificativa?: string | null
          modalidade_compra?: string | null
          modalidade_definida_em?: string | null
          modalidade_definida_por?: string | null
          observacao_administrativa?: string | null
          observacao_compras?: string | null
          origem?: string
          orcamento_previo_total?: number | null
          orcamentos_em?: string | null
          pagamento_nf_em?: string | null
          pedido_compra_id?: number | null
          planejamento_id?: number | null
          projeto_id?: number | null
          protocolo_externo?: string | null
          recebido_em?: string | null
          recebido_por?: string | null
          rubrica?: string | null
          solicitante?: string | null
          status?: string
          tipo_demanda?: string
          titulo: string
          urgencia?: string
          validado_em?: string | null
        }
        Update: {
          analisado_em?: string | null
          aprovacao_final_em?: string | null
          aprovado_coordenador_em?: string | null
          aprovador_coordenador?: string | null
          aprovador_coordenador_diferente?: boolean
          atualizado_em?: string
          comprador_responsavel?: string | null
          concluido_em?: string | null
          conformidade_admin?: string | null
          coordenador_projeto_email?: string | null
          coordenador_projeto_nome?: string | null
          criado_em?: string
          data_envio_instituicao?: string | null
          data_necessidade?: string | null
          data_retorno_instituicao?: string | null
          encaminhado_em?: string | null
          enviado_validacao_em?: string | null
          fechado_em?: string | null
          fonte_recurso?: string | null
          formalizado_em?: string | null
          id?: never
          instituicao_destino?: string | null
          justificativa?: string | null
          modalidade_compra?: string | null
          modalidade_definida_em?: string | null
          modalidade_definida_por?: string | null
          observacao_administrativa?: string | null
          observacao_compras?: string | null
          origem?: string
          orcamento_previo_total?: number | null
          orcamentos_em?: string | null
          pagamento_nf_em?: string | null
          pedido_compra_id?: number | null
          planejamento_id?: number | null
          projeto_id?: number | null
          protocolo_externo?: string | null
          recebido_em?: string | null
          recebido_por?: string | null
          rubrica?: string | null
          solicitante?: string | null
          status?: string
          tipo_demanda?: string
          titulo?: string
          urgencia?: string
          validado_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_internos_pedido_compra_id_fkey"
            columns: ["pedido_compra_id"]
            isOneToOne: false
            referencedRelation: "pedidos_compra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_internos_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "planejamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_internos_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "v_margem_real_planejamento"
            referencedColumns: ["planejamento_id"]
          },
          {
            foreignKeyName: "pedidos_internos_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "v_planejamento_compromissos_estoque"
            referencedColumns: ["planejamento_id"]
          },
          {
            foreignKeyName: "pedidos_internos_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_internos_anexos: {
        Row: {
          arquivo_nome: string | null
          criado_em: string
          etapa: string | null
          hash_sha256: string | null
          id: number
          mime_type: string | null
          observacao: string | null
          pedido_interno_id: number
          storage_bucket: string | null
          storage_path: string | null
          tamanho_bytes: number | null
          tipo: string
          titulo: string
          url: string | null
          usuario: string | null
        }
        Insert: {
          arquivo_nome?: string | null
          criado_em?: string
          etapa?: string | null
          hash_sha256?: string | null
          id?: never
          mime_type?: string | null
          observacao?: string | null
          pedido_interno_id: number
          storage_bucket?: string | null
          storage_path?: string | null
          tamanho_bytes?: number | null
          tipo?: string
          titulo: string
          url?: string | null
          usuario?: string | null
        }
        Update: {
          arquivo_nome?: string | null
          criado_em?: string
          etapa?: string | null
          hash_sha256?: string | null
          id?: never
          mime_type?: string | null
          observacao?: string | null
          pedido_interno_id?: number
          storage_bucket?: string | null
          storage_path?: string | null
          tamanho_bytes?: number | null
          tipo?: string
          titulo?: string
          url?: string | null
          usuario?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_internos_anexos_pedido_interno_id_fkey"
            columns: ["pedido_interno_id"]
            isOneToOne: false
            referencedRelation: "pedidos_internos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_internos_aprovacoes: {
        Row: {
          comentario: string | null
          criado_em: string
          decisao: string
          etapa: string
          id: number
          papel: string | null
          pedido_interno_id: number
          responsavel: string | null
          status_destino: string | null
          status_origem: string | null
        }
        Insert: {
          comentario?: string | null
          criado_em?: string
          decisao: string
          etapa: string
          id?: never
          papel?: string | null
          pedido_interno_id: number
          responsavel?: string | null
          status_destino?: string | null
          status_origem?: string | null
        }
        Update: {
          comentario?: string | null
          criado_em?: string
          decisao?: string
          etapa?: string
          id?: never
          papel?: string | null
          pedido_interno_id?: number
          responsavel?: string | null
          status_destino?: string | null
          status_origem?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_internos_aprovacoes_pedido_interno_id_fkey"
            columns: ["pedido_interno_id"]
            isOneToOne: false
            referencedRelation: "pedidos_internos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_internos_comunicacoes: {
        Row: {
          assunto: string | null
          criado_em: string
          destinatarios: string | null
          etapa: string | null
          id: number
          observacao: string | null
          pedido_interno_id: number
          referencia: string | null
          remetente: string | null
          tipo: string
          usuario: string | null
        }
        Insert: {
          assunto?: string | null
          criado_em?: string
          destinatarios?: string | null
          etapa?: string | null
          id?: never
          observacao?: string | null
          pedido_interno_id: number
          referencia?: string | null
          remetente?: string | null
          tipo?: string
          usuario?: string | null
        }
        Update: {
          assunto?: string | null
          criado_em?: string
          destinatarios?: string | null
          etapa?: string | null
          id?: never
          observacao?: string | null
          pedido_interno_id?: number
          referencia?: string | null
          remetente?: string | null
          tipo?: string
          usuario?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_internos_comunicacoes_pedido_interno_id_fkey"
            columns: ["pedido_interno_id"]
            isOneToOne: false
            referencedRelation: "pedidos_internos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_internos_item_recebimentos: {
        Row: {
          codigo_lote: string | null
          custo_unitario: number | null
          fornecedor: string | null
          id: number
          insumo_id: number
          lote_id: number
          observacao: string | null
          pedido_compra_item_id: number | null
          pedido_interno_id: number
          pedido_interno_item_id: number
          quantidade: number
          recebido_em: string
          responsavel: string | null
          validade: string | null
        }
        Insert: {
          codigo_lote?: string | null
          custo_unitario?: number | null
          fornecedor?: string | null
          id?: never
          insumo_id: number
          lote_id: number
          observacao?: string | null
          pedido_compra_item_id?: number | null
          pedido_interno_id: number
          pedido_interno_item_id: number
          quantidade: number
          recebido_em?: string
          responsavel?: string | null
          validade?: string | null
        }
        Update: {
          codigo_lote?: string | null
          custo_unitario?: number | null
          fornecedor?: string | null
          id?: never
          insumo_id?: number
          lote_id?: number
          observacao?: string | null
          pedido_compra_item_id?: number | null
          pedido_interno_id?: number
          pedido_interno_item_id?: number
          quantidade?: number
          recebido_em?: string
          responsavel?: string | null
          validade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_internos_item_recebimentos_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_internos_item_recebimentos_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_custo_estoque_vigente"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "pedidos_internos_item_recebimentos_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_estoque_saldo"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "pedidos_internos_item_recebimentos_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_previsao_suprimentos"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "pedidos_internos_item_recebimentos_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_estoque"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_internos_item_recebimentos_pedido_compra_item_id_fkey"
            columns: ["pedido_compra_item_id"]
            isOneToOne: false
            referencedRelation: "pedidos_compra_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_internos_item_recebimentos_pedido_interno_id_fkey"
            columns: ["pedido_interno_id"]
            isOneToOne: false
            referencedRelation: "pedidos_internos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_internos_item_recebimentos_pedido_interno_item_id_fkey"
            columns: ["pedido_interno_item_id"]
            isOneToOne: false
            referencedRelation: "pedidos_internos_itens"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_internos_itens: {
        Row: {
          criado_em: string
          divergencia_recebimento: string | null
          especificacao: string
          fornecedor_sugerido: string | null
          id: number
          insumo_id: number | null
          lote_id: number | null
          modelo: string | null
          observacao: string | null
          orcamento_previo: number | null
          pedido_interno_id: number
          quantidade: number
          quantidade_recebida: number | null
          recebido_em: string | null
          recebido_por: string | null
          tipo: string
          unidade: string | null
          volume: string | null
          conteudo_embalagem: number | null
          quantidade_em: string | null
        }
        Insert: {
          criado_em?: string
          divergencia_recebimento?: string | null
          especificacao: string
          fornecedor_sugerido?: string | null
          id?: never
          insumo_id?: number | null
          lote_id?: number | null
          modelo?: string | null
          observacao?: string | null
          orcamento_previo?: number | null
          pedido_interno_id: number
          quantidade?: number
          quantidade_recebida?: number | null
          recebido_em?: string | null
          recebido_por?: string | null
          tipo?: string
          unidade?: string | null
          volume?: string | null
          conteudo_embalagem?: number | null
          quantidade_em?: string | null
        }
        Update: {
          criado_em?: string
          divergencia_recebimento?: string | null
          especificacao?: string
          fornecedor_sugerido?: string | null
          id?: never
          insumo_id?: number | null
          lote_id?: number | null
          modelo?: string | null
          observacao?: string | null
          orcamento_previo?: number | null
          pedido_interno_id?: number
          quantidade?: number
          quantidade_recebida?: number | null
          recebido_em?: string | null
          recebido_por?: string | null
          tipo?: string
          unidade?: string | null
          volume?: string | null
          conteudo_embalagem?: number | null
          quantidade_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_internos_itens_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_internos_itens_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_custo_estoque_vigente"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "pedidos_internos_itens_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_estoque_saldo"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "pedidos_internos_itens_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_previsao_suprimentos"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "pedidos_internos_itens_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_estoque"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_internos_itens_pedido_interno_id_fkey"
            columns: ["pedido_interno_id"]
            isOneToOne: false
            referencedRelation: "pedidos_internos"
            referencedColumns: ["id"]
          },
        ]
      }
      perfis: {
        Row: {
          assinatura_path: string | null
          assinatura_url: string | null
          criado_em: string
          email: string | null
          id: string
          nome: string | null
          papel: string
          permissoes: Json
          senha_provisoria: boolean
          suspenso: boolean
        }
        Insert: {
          assinatura_path?: string | null
          assinatura_url?: string | null
          criado_em?: string
          email?: string | null
          id: string
          nome?: string | null
          papel?: string
          permissoes?: Json
          senha_provisoria?: boolean
          suspenso?: boolean
        }
        Update: {
          assinatura_path?: string | null
          assinatura_url?: string | null
          criado_em?: string
          email?: string | null
          id?: string
          nome?: string | null
          papel?: string
          permissoes?: Json
          senha_provisoria?: boolean
          suspenso?: boolean
        }
        Relationships: []
      }
      permissoes_categorias: {
        Row: {
          atualizado_em: string
          papel: string
          permissoes: Json
        }
        Insert: {
          atualizado_em?: string
          papel: string
          permissoes?: Json
        }
        Update: {
          atualizado_em?: string
          papel?: string
          permissoes?: Json
        }
        Relationships: []
      }
      planejamento: {
        Row: {
          concluido_em: string | null
          criado_em: string
          data_alvo: string | null
          data_fim_prevista: string | null
          data_inicio_prevista: string | null
          id: number
          iniciado_em: string | null
          nome: string | null
          observacao: string | null
          orcamento_id: number | null
          orcamento_final_versao_id: number | null
          orcamento_projeto_id: number | null
          origem_planejamento: string
          planejado_por: string | null
          prioridade: string
          projeto: string | null
          projeto_id: number | null
          reservado_em: string | null
          reserva_desatualizada: boolean
          reservado_por: string | null
          responsavel: string | null
          status_operacional: string
          validado_em: string | null
          validado_por: string | null
        }
        Insert: {
          concluido_em?: string | null
          criado_em?: string
          data_alvo?: string | null
          data_fim_prevista?: string | null
          data_inicio_prevista?: string | null
          id?: never
          iniciado_em?: string | null
          nome?: string | null
          observacao?: string | null
          orcamento_id?: number | null
          orcamento_final_versao_id?: number | null
          orcamento_projeto_id?: number | null
          origem_planejamento?: string
          planejado_por?: string | null
          prioridade?: string
          projeto?: string | null
          projeto_id?: number | null
          reservado_em?: string | null
          reserva_desatualizada?: boolean
          reservado_por?: string | null
          responsavel?: string | null
          status_operacional?: string
          validado_em?: string | null
          validado_por?: string | null
        }
        Update: {
          concluido_em?: string | null
          criado_em?: string
          data_alvo?: string | null
          data_fim_prevista?: string | null
          data_inicio_prevista?: string | null
          id?: never
          iniciado_em?: string | null
          nome?: string | null
          observacao?: string | null
          orcamento_id?: number | null
          orcamento_final_versao_id?: number | null
          orcamento_projeto_id?: number | null
          origem_planejamento?: string
          planejado_por?: string | null
          prioridade?: string
          projeto?: string | null
          projeto_id?: number | null
          reservado_em?: string | null
          reserva_desatualizada?: boolean
          reservado_por?: string | null
          responsavel?: string | null
          status_operacional?: string
          validado_em?: string | null
          validado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "planejamento_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planejamento_orcamento_projeto_id_fkey"
            columns: ["orcamento_projeto_id"]
            isOneToOne: false
            referencedRelation: "orcamento_projetos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planejamento_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      planejamento_itens: {
        Row: {
          codigo_analise: string
          id: number
          n_amostras: number
          n_controles: number
          perda_percentual: number
          planejamento_id: number
          repeticoes: number
        }
        Insert: {
          codigo_analise: string
          id?: never
          n_amostras?: number
          n_controles?: number
          perda_percentual?: number
          planejamento_id: number
          repeticoes?: number
        }
        Update: {
          codigo_analise?: string
          id?: never
          n_amostras?: number
          n_controles?: number
          perda_percentual?: number
          planejamento_id?: number
          repeticoes?: number
        }
        Relationships: [
          {
            foreignKeyName: "planejamento_itens_codigo_analise_fkey"
            columns: ["codigo_analise"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "planejamento_itens_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "planejamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planejamento_itens_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "v_margem_real_planejamento"
            referencedColumns: ["planejamento_id"]
          },
          {
            foreignKeyName: "planejamento_itens_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "v_planejamento_compromissos_estoque"
            referencedColumns: ["planejamento_id"]
          },
        ]
      }
      planejamento_lote_conferencias: {
        Row: {
          conferido_em: string
          conferido_por: string | null
          id: number
          insumo_id: number
          justificativa: string | null
          lote_id: number
          planejamento_id: number
          quantidade_conferida: number
          quantidade_prevista: number
          status: string
        }
        Insert: {
          conferido_em?: string
          conferido_por?: string | null
          id?: never
          insumo_id: number
          justificativa?: string | null
          lote_id: number
          planejamento_id: number
          quantidade_conferida: number
          quantidade_prevista: number
          status?: string
        }
        Update: {
          conferido_em?: string
          conferido_por?: string | null
          id?: never
          insumo_id?: number
          justificativa?: string | null
          lote_id?: number
          planejamento_id?: number
          quantidade_conferida?: number
          quantidade_prevista?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "planejamento_lote_conferencias_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planejamento_lote_conferencias_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_custo_estoque_vigente"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "planejamento_lote_conferencias_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_estoque_saldo"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "planejamento_lote_conferencias_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_previsao_suprimentos"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "planejamento_lote_conferencias_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_estoque"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planejamento_lote_conferencias_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "planejamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planejamento_lote_conferencias_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "v_margem_real_planejamento"
            referencedColumns: ["planejamento_id"]
          },
          {
            foreignKeyName: "planejamento_lote_conferencias_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "v_planejamento_compromissos_estoque"
            referencedColumns: ["planejamento_id"]
          },
        ]
      }
      projetos: {
        Row: {
          cliente_id: number | null
          coordenador: string | null
          coordenador_email: string | null
          coordenador_nome: string | null
          criado_em: string
          data_fim: string | null
          data_inicio: string | null
          descricao: string | null
          id: number
          nome: string
          responsavel: string | null
          status: string
        }
        Insert: {
          cliente_id?: number | null
          coordenador?: string | null
          coordenador_email?: string | null
          coordenador_nome?: string | null
          criado_em?: string
          data_fim?: string | null
          data_inicio?: string | null
          descricao?: string | null
          id?: never
          nome: string
          responsavel?: string | null
          status?: string
        }
        Update: {
          cliente_id?: number | null
          coordenador?: string | null
          coordenador_email?: string | null
          coordenador_nome?: string | null
          criado_em?: string
          data_fim?: string | null
          data_inicio?: string | null
          descricao?: string | null
          id?: never
          nome?: string
          responsavel?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "projetos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas_estoque: {
        Row: {
          consumido_em: string | null
          criado_em: string
          criado_por: string | null
          id: number
          insumo_id: number
          liberado_em: string | null
          lote_id: number | null
          observacao: string | null
          origem: string
          planejamento_id: number | null
          quantidade: number
          quantidade_consumida: number
          status: string
        }
        Insert: {
          consumido_em?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: never
          insumo_id: number
          liberado_em?: string | null
          lote_id?: number | null
          observacao?: string | null
          origem?: string
          planejamento_id?: number | null
          quantidade: number
          quantidade_consumida?: number
          status?: string
        }
        Update: {
          consumido_em?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: never
          insumo_id?: number
          liberado_em?: string | null
          lote_id?: number | null
          observacao?: string | null
          origem?: string
          planejamento_id?: number | null
          quantidade?: number
          quantidade_consumida?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservas_estoque_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_estoque_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_custo_estoque_vigente"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "reservas_estoque_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_estoque_saldo"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "reservas_estoque_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_previsao_suprimentos"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "reservas_estoque_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_estoque"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_estoque_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "planejamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_estoque_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "v_margem_real_planejamento"
            referencedColumns: ["planejamento_id"]
          },
          {
            foreignKeyName: "reservas_estoque_planejamento_id_fkey"
            columns: ["planejamento_id"]
            isOneToOne: false
            referencedRelation: "v_planejamento_compromissos_estoque"
            referencedColumns: ["planejamento_id"]
          },
        ]
      }
      scan_eventos: {
        Row: {
          acao: string
          codigo: string
          contexto: Json
          criado_em: string
          entidade_id: number | null
          entidade_tipo: string | null
          formato: string | null
          id: number
          identificador_id: number | null
          origem: string
          resultado: string
          usuario: string | null
          usuario_id: string | null
          valor_lido: string
        }
        Insert: {
          acao?: string
          codigo: string
          contexto?: Json
          criado_em?: string
          entidade_id?: number | null
          entidade_tipo?: string | null
          formato?: string | null
          id?: number
          identificador_id?: number | null
          origem?: string
          resultado?: string
          usuario?: string | null
          usuario_id?: string | null
          valor_lido: string
        }
        Update: {
          acao?: string
          codigo?: string
          contexto?: Json
          criado_em?: string
          entidade_id?: number | null
          entidade_tipo?: string | null
          formato?: string | null
          id?: number
          identificador_id?: number | null
          origem?: string
          resultado?: string
          usuario?: string | null
          usuario_id?: string | null
          valor_lido?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_eventos_identificador_id_fkey"
            columns: ["identificador_id"]
            isOneToOne: false
            referencedRelation: "identificadores"
            referencedColumns: ["id"]
          },
        ]
      }
      system_heartbeat: {
        Row: {
          app: string
          deployment_url: string | null
          details: Json
          environment: string | null
          id: string
          status: string
          updated_at: string
        }
        Insert: {
          app: string
          deployment_url?: string | null
          details?: Json
          environment?: string | null
          id: string
          status?: string
          updated_at?: string
        }
        Update: {
          app?: string
          deployment_url?: string | null
          details?: Json
          environment?: string | null
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      tecnicos: {
        Row: {
          ativo: boolean
          horas_mes_base: number
          id: number
          nome: string
          percentual_dedicado: number
          processo: string | null
          valor_mes: number
        }
        Insert: {
          ativo?: boolean
          horas_mes_base?: number
          id?: never
          nome: string
          percentual_dedicado?: number
          processo?: string | null
          valor_mes?: number
        }
        Update: {
          ativo?: boolean
          horas_mes_base?: number
          id?: never
          nome?: string
          percentual_dedicado?: number
          processo?: string | null
          valor_mes?: number
        }
        Relationships: []
      }
      tipo_insumos: {
        Row: {
          ativo: boolean
          classe: string
          criado_em: string
          finalidade: string | null
          id: number
          nome: string
          observacoes: string | null
          unidade_referencia: string | null
        }
        Insert: {
          ativo?: boolean
          classe?: string
          criado_em?: string
          finalidade?: string | null
          id?: never
          nome: string
          observacoes?: string | null
          unidade_referencia?: string | null
        }
        Update: {
          ativo?: boolean
          classe?: string
          criado_em?: string
          finalidade?: string | null
          id?: never
          nome?: string
          observacoes?: string | null
          unidade_referencia?: string | null
        }
        Relationships: []
      }
      usuarios_pre_aprovados: {
        Row: {
          criado_em: string
          email: string
          id: number
          nome: string
          observacao: string | null
          papel: string
          permissoes: Json
        }
        Insert: {
          criado_em?: string
          email: string
          id?: never
          nome: string
          observacao?: string | null
          papel?: string
          permissoes?: Json
        }
        Update: {
          criado_em?: string
          email?: string
          id?: never
          nome?: string
          observacao?: string | null
          papel?: string
          permissoes?: Json
        }
        Relationships: []
      }
    }
    Views: {
      v_alertas_estoque: {
        Row: {
          especificacao: string | null
          insumo_id: number | null
          lote_id: number | null
          referencia: number | null
          tipo: string | null
          validade: string | null
          valor: number | null
        }
        Relationships: []
      }
      v_custo_estoque_vigente: {
        Row: {
          custo_normalizado: number | null
          custo_origem: number | null
          custo_medio_ponderado: number | null
          custo_padrao: number | null
          divergencia_absoluta: number | null
          divergencia_percentual: number | null
          especificacao: string | null
          fator_conversao: number | null
          fonte_custo: string | null
          insumo_id: number | null
          quantidade_liberada: number | null
          referencia_custo: string | null
          situacao: string | null
          unidade: string | null
          unidade_consumo: string | null
          unidade_estoque: string | null
          valor_liberado: number | null
        }
        Relationships: []
      }
      v_custo_real_consumo: {
        Row: {
          custo_real_total: number | null
          custo_real_unitario: number | null
          data: string | null
          especificacao: string | null
          insumo_id: number | null
          lote_id: number | null
          motivo: string | null
          movimentacao_id: number | null
          quantidade: number | null
          referencia: string | null
          unidade: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_movimentacoes_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_custo_estoque_vigente"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_estoque_saldo"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_previsao_suprimentos"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_estoque"
            referencedColumns: ["id"]
          },
        ]
      }
      v_dashboard_executivo: {
        Row: {
          compras_abertas_valor: number | null
          gasto_por_projeto_mes: Json | null
          lotes_vencendo_horizonte: number | null
          margem_media_pct: number | null
          orcamentos_aprovados: number | null
          orcamentos_enviados: number | null
          orcamentos_perdidos: number | null
          orcamentos_rascunho: number | null
          valor_estoque_ativo: number | null
          valor_vencendo_horizonte: number | null
        }
        Relationships: []
      }
      v_estoque_saldo: {
        Row: {
          bloqueado: number | null
          categoria_compra: string | null
          classe_tipo_insumo: string | null
          disponivel: number | null
          em_maos: number | null
          em_quarentena: number | null
          especificacao: string | null
          estoque_seguranca: number | null
          insumo_id: number | null
          lead_time_dias: number | null
          modelo_quantidade: string | null
          nome_item: string | null
          ponto_reposicao: number | null
          reservado: number | null
          tipo_insumo: string | null
          tipo_insumo_id: number | null
          unidade: string | null
          unidade_saldo: string | null
          vencido: number | null
        }
        Relationships: [
          {
            foreignKeyName: "insumos_tipo_insumo_id_fkey"
            columns: ["tipo_insumo_id"]
            isOneToOne: false
            referencedRelation: "tipo_insumos"
            referencedColumns: ["id"]
          },
        ]
      }
      v_estoque_saldo_tipo: {
        Row: {
          bloqueado: number | null
          classe_tipo_insumo: string | null
          disponivel: number | null
          em_maos: number | null
          em_quarentena: number | null
          itens_especificos: number | null
          ponto_reposicao_total: number | null
          reservado: number | null
          tipo_insumo: string | null
          tipo_insumo_id: number | null
          unidade: string | null
          vencido: number | null
        }
        Relationships: [
          {
            foreignKeyName: "insumos_tipo_insumo_id_fkey"
            columns: ["tipo_insumo_id"]
            isOneToOne: false
            referencedRelation: "tipo_insumos"
            referencedColumns: ["id"]
          },
        ]
      }
      v_insumo_analise_pendencias: {
        Row: {
          codigo_analise: string | null
          especificacao_insumo: string | null
          etapa_id: number | null
          id: number | null
          insumo_id: number | null
          nome_atividade: string | null
          nome_etapa: string | null
          status_vinculo: string | null
        }
        Insert: {
          codigo_analise?: string | null
          especificacao_insumo?: string | null
          etapa_id?: number | null
          id?: number | null
          insumo_id?: number | null
          nome_atividade?: string | null
          nome_etapa?: string | null
          status_vinculo?: never
        }
        Update: {
          codigo_analise?: string | null
          especificacao_insumo?: string | null
          etapa_id?: number | null
          id?: number | null
          insumo_id?: number | null
          nome_atividade?: string | null
          nome_etapa?: string | null
          status_vinculo?: never
        }
        Relationships: [
          {
            foreignKeyName: "insumo_analise_codigo_analise_fkey"
            columns: ["codigo_analise"]
            isOneToOne: false
            referencedRelation: "analises"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "insumo_analise_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "etapas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insumo_analise_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insumo_analise_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_custo_estoque_vigente"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "insumo_analise_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_estoque_saldo"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "insumo_analise_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_previsao_suprimentos"
            referencedColumns: ["insumo_id"]
          },
        ]
      }
      v_margem_real_planejamento: {
        Row: {
          custo_orcado: number | null
          custo_real_insumos: number | null
          margem_prevista: number | null
          margem_real_parcial: number | null
          margem_real_parcial_percentual: number | null
          orcamento_id: number | null
          planejamento_id: number | null
          quantidade_movimentacoes: number | null
          receita_orcada: number | null
        }
        Relationships: [
          {
            foreignKeyName: "planejamento_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      v_minhas_notificacoes: {
        Row: {
          arquivada_em: string | null
          canal: string | null
          corpo: string | null
          criado_em: string | null
          entidade_id: number | null
          entidade_tipo: string | null
          id: number | null
          lida_em: string | null
          papel_destino: string | null
          permissao_destino: string | null
          status: string | null
          tipo: string | null
          titulo: string | null
          usuario_destino: string | null
        }
        Relationships: []
      }
      v_planejamento_compromissos_estoque: {
        Row: {
          data_alvo: string | null
          data_fim_prevista: string | null
          data_inicio_prevista: string | null
          especificacao: string | null
          insumo_id: number | null
          lote_id: number | null
          planejamento_id: number | null
          planejamento_nome: string | null
          prioridade: string | null
          projeto_id: number | null
          projeto_nome: string | null
          quantidade_comprometida: number | null
          status_operacional: string | null
          unidade: string | null
          unidade_quantidade: string | null
        }
        Relationships: [
          {
            foreignKeyName: "planejamento_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_estoque_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_estoque_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_custo_estoque_vigente"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "reservas_estoque_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_estoque_saldo"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "reservas_estoque_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "v_previsao_suprimentos"
            referencedColumns: ["insumo_id"]
          },
          {
            foreignKeyName: "reservas_estoque_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_estoque"
            referencedColumns: ["id"]
          },
        ]
      }
      v_proposta_aprovada_vigente: {
        Row: {
          classificado_em: string | null
          cliente_id: number | null
          cliente_nome: string | null
          criado_em: string | null
          demanda_id: number | null
          numero: string | null
          projeto_id: number | null
          status: string | null
          titulo: string | null
          total_final: number | null
          total_laboratorio_custo: number | null
          total_laboratorio_preco: number | null
          total_projeto_custo: number | null
          total_projeto_final: number | null
          valido_ate: string | null
          versao: number | null
          versao_id: number | null
        }
        Relationships: []
      }
      v_previsao_suprimentos: {
        Row: {
          categoria_compra: string | null
          consumo_janela: number | null
          consumo_medio_diario: number | null
          custo_unitario: number | null
          dias_cobertura: number | null
          disponivel: number | null
          em_maos: number | null
          especificacao: string | null
          estoque_seguranca: number | null
          fornecedor_id: number | null
          fornecedor_nome: string | null
          insumo_id: number | null
          janela_dias: number | null
          lead_time_dias: number | null
          ponto_reposicao_configurado: number | null
          ponto_reposicao_sugerido: number | null
          qtd_pedida_aberta: number | null
          qtd_sugerida_compra: number | null
          reservado: number | null
          unidade: string | null
          unidade_saldo: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insumos_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      aceitar_lote: {
        Args: { p_criterio?: string; p_lote_id: number; p_responsavel?: string }
        Returns: undefined
      }
      ajustar_saldo_lote: {
        Args: { p_lote_id: number; p_motivo: string; p_quantidade_nova: number }
        Returns: undefined
      }
      aguardando_voce: { Args: never; Returns: Json }
      aplicar_ajuste_inventario_contagem: {
        Args: { p_contagem_id: number }
        Returns: Json
      }
      aprovar_orcamento_publico: {
        Args: { p_nome: string; p_token: string }
        Returns: Json
      }
      baixa_manual_lote:
        | {
            Args: { p_lote_id: number; p_motivo: string; p_quantidade: number }
            Returns: undefined
          }
        | {
            Args: {
              p_lote_id: number
              p_motivo: string
              p_operacao_id: string
              p_quantidade: number
            }
            Returns: Json
          }
      bloquear_lote: {
        Args: { p_lote_id: number; p_motivo: string }
        Returns: undefined
      }
      cancelar_pedido_interno_operacional: {
        Args: {
          p_observacao?: string
          p_pedido_id: number
          p_responsavel?: string
        }
        Returns: Json
      }
      cancelar_planejamento_operacional: {
        Args: { p_planejamento_id: number }
        Returns: undefined
      }
      concluir_planejamento: {
        Args: { p_planejamento_id: number }
        Returns: undefined
      }
      criar_pedido_faltas_planejamento: {
        Args: { p_itens: Json; p_planejamento_id: number }
        Returns: Json
      }
      criar_pedido_reposicao_estoque: {
        Args: {
          p_data_necessidade: string
          p_itens: Json
          p_justificativa: string
          p_titulo: string
          p_urgencia: string
        }
        Returns: Json
      }
      current_papel: { Args: never; Returns: string }
      dar_baixa_plano: { Args: { p_planejamento_id: number }; Returns: Json }
      gerar_planejamento_da_proposta: { Args: { p_versao_id: number }; Returns: Json }
      duplicar_orcamento_final_transacional: {
        Args: {
          p_operacao_id: string
          p_validade_dias: number
          p_versao_id: number
        }
        Returns: Json
      }
      desbloquear_lote: { Args: { p_lote_id: number }; Returns: undefined }
      destinatarios_notificacao: {
        Args: { p_notificacao_id: number }
        Returns: string[]
      }
      descartar_lote: {
        Args: { p_justificativa: string; p_lote_id: number }
        Returns: undefined
      }
      emitir_orcamento_final_transacional: {
        Args: {
          p_criado_por: string
          p_demanda_id: number
          p_operacao_id: string
          p_parametros: Json
          p_snapshot: Json
          p_total_final: number
          p_total_laboratorio_custo: number
          p_total_laboratorio_preco: number
          p_total_projeto_custo: number
          p_total_projeto_final: number
          p_usuario_email: string
          p_validade_dias: number
        }
        Returns: Json
      }
      entrada_inventario:
        | {
            Args: {
              p_codigo?: string
              p_custo?: number
              p_fornecedor?: string
              p_insumo_id: number
              p_motivo?: string
              p_quantidade: number
              p_validade?: string
            }
            Returns: number
          }
        | {
            Args: {
              p_codigo?: string
              p_custo?: number
              p_fornecedor?: string
              p_insumo_id: number
              p_local_id?: number
              p_motivo?: string
              p_operacao_id: string
              p_quantidade: number
              p_validade?: string
            }
            Returns: Json
          }
      estornar_recebimento_item_pedido_interno: {
        Args: {
          p_item_id: number
          p_motivo?: string
          p_pedido_id: number
          p_recebimento_id?: number
        }
        Returns: undefined
      }
      estornar_recebimento_do_lote: {
        Args: { p_lote_id: number; p_motivo: string }
        Returns: Json
      }
      estornar_recebimento_lote: {
        Args: { p_lote_id: number; p_motivo?: string }
        Returns: undefined
      }
      fn_exige_papel: { Args: { p_min: string }; Returns: undefined }
      formalizar_pedido_interno: {
        Args: { p_pedido_id: number }
        Returns: Json
      }
      gerar_reposicao_automatica: { Args: never; Returns: Json }
      ler_orcamento_publico: { Args: { p_token: string }; Returns: Json }
      liberar_plano: { Args: { p_planejamento_id: number }; Returns: undefined }
      marcar_todas_notificacoes_lidas: { Args: never; Returns: number }
      marcar_planejamento_em_execucao: {
        Args: { p_planejamento_id: number }
        Returns: undefined
      }
      marcar_planejamento_reservado: {
        Args: { p_planejamento_id: number }
        Returns: undefined
      }
      menor_validade: {
        Args: { p_abertura: string; p_fabricante: string }
        Returns: string
      }
      orcamento_projeto_catalogo_listar: {
        Args: never
        Returns: {
          ativo: boolean
          atualizado_em: string
          categoria: string | null
          criado_em: string
          descricao: string
          id: string
          origem: string
          preco_mascarado: boolean
          preco_unitario: number | null
          rubrica: string
          unidade: string | null
          valid_from: string | null
        }[]
      }
      papel_minimo: { Args: { p_min: string }; Returns: boolean }
      recalcular_orcamento_transacional: {
        Args: {
          p_fonte_custo_insumos: string
          p_itens: Json
          p_motivo: string
          p_operacao_id: string
          p_orcamento_id: number
          p_revisao_esperada: number
          p_snapshot: Json
        }
        Returns: Json
      }
      receber_item_pedido_compra:
        | {
            Args: {
              p_codigo?: string
              p_item_id: number
              p_pedido_id: number
              p_quantidade?: number
              p_validade?: string
            }
            Returns: number
          }
        | {
            Args: {
              p_codigo?: string
              p_item_id: number
              p_pedido_id: number
              p_quantidade?: number
              p_responsavel?: string
              p_validade?: string
            }
            Returns: number
          }
        | {
            Args: {
              p_codigo?: string
              p_conteudo_embalagem?: number
              p_item_id: number
              p_local_id?: number
              p_operacao_id: string
              p_pedido_id: number
              p_quantidade?: number
              p_responsavel?: string
              p_validade?: string
            }
            Returns: number
          }
      receber_item_pedido_interno: {
        Args: {
          p_codigo?: string
          p_custo?: number
          p_fornecedor?: string
          p_insumo_id: number
          p_item_id: number
          p_pedido_id: number
          p_projeto?: string
          p_quantidade: number
          p_responsavel?: string
          p_validade?: string
        }
        Returns: number
      }
      receber_lote: {
        Args: {
          p_codigo?: string
          p_custo?: number
          p_fornecedor?: string
          p_insumo_id: number
          p_local_id?: number
          p_nota_fiscal?: string
          p_projeto?: string
          p_quantidade: number
          p_validade?: string
        }
        Returns: number
      }
      registrar_etapa_pedido_interno: {
        Args: {
          p_dados?: Json
          p_decisao: string
          p_etapa: string
          p_observacao?: string
          p_pedido_id: number
          p_status_destino: string
        }
        Returns: Json
      }
      registrar_modalidade_pedido_interno: {
        Args: {
          p_instituicao_destino?: string
          p_modalidade: string
          p_observacao?: string
          p_pedido_id: number
          p_protocolo_externo?: string
          p_responsavel?: string
        }
        Returns: undefined
      }
      reservar_equipamento_planejamento: {
        Args: {
          p_data_fim: string
          p_data_inicio: string
          p_equipamento_unidade_id: number
          p_observacao?: string
          p_planejamento_id: number
          p_responsavel?: string
        }
        Returns: number
      }
      reservar_plano: {
        Args: { p_itens: Json; p_planejamento_id: number }
        Returns: Json
      }
      resolver_triagem_criando_insumo: {
        Args: {
          p_criado_por?: string
          p_custo_total_embalagem?: number
          p_especificacao: string
          p_fator_conversao: number
          p_quantidade_embalagem: number
          p_triagem_id: number
          p_unidade: string
          p_unidade_consumo: string
        }
        Returns: {
          identificador_id: number
          insumo_id: number
          triagem_id: number
        }[]
      }
      salvar_item_orcamento: {
        Args: {
          p_codigo_analise: string
          p_custo_snapshot: Json
          p_custo_unitario: number
          p_n_amostras: number
          p_orcamento_id: number
          p_preco_unitario: number
          p_valor_snapshot: Json
        }
        Returns: Json
      }
      tecnicos_remuneracao: {
        Args: never
        Returns: { id: number; valor_mes: number | null }[]
      }
      tem_permissao: { Args: { p_chave: string }; Returns: boolean }
      transicionar_orcamento: {
        Args: {
          p_observacao?: string
          p_orcamento_id: number
          p_status_destino: string
        }
        Returns: Json
      }
      transicionar_orcamento_final: {
        Args: {
          p_motivo?: string | null
          p_status_destino: string
          p_versao_id: number
        }
        Returns: Json
      }
      transicionar_orcamento_projeto: {
        Args: {
          p_observacao?: string
          p_orcamento_projeto_id: number
          p_status_destino: string
        }
        Returns: Json
      }
      transicionar_pedido_compra: {
        Args: {
          p_data_prevista_entrega?: string
          p_observacao?: string
          p_pedido_id: number
          p_status_destino: string
        }
        Returns: Json
      }
      transicionar_pedido_interno: {
        Args: {
          p_decisao: string
          p_etapa: string
          p_observacao?: string
          p_pedido_id: number
          p_status_destino: string
        }
        Returns: Json
      }
      validar_planejamento_executivo: {
        Args: { p_planejamento_id: number }
        Returns: undefined
      }
      vencer_orcamentos_finais: { Args: never; Returns: number }
      valor_hora_pessoal_total: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

