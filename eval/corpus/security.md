# Northwind Security Policy (sample corpus)

## Access
Production access requires multi-factor authentication. Shared accounts are not
permitted, and every action in production is attributable to one person.

## Backups
Backups run nightly and are restored into a scratch environment once a month.
A backup that has never been restored is not considered a backup.

## Incidents
Any suspected breach is reported within one hour, even when it turns out to be
nothing. Reporting late is treated more seriously than reporting wrongly.
