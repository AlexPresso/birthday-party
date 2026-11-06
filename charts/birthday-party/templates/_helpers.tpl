{{- define "birthday-party.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 52 | trimSuffix "-" -}}
{{- end -}}

{{- define "birthday-party.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 52 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "birthday-party.name" .) | trunc 52 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "birthday-party.selectorLabels" -}}
app.kubernetes.io/name: {{ include "birthday-party.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "birthday-party.labels" -}}
{{ include "birthday-party.selectorLabels" . }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
